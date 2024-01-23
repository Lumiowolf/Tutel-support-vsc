import * as vscode from 'vscode';
import {
	InitializedEvent, TerminatedEvent, StoppedEvent,
	StackFrame, Scope, Source, Handles, Breakpoint, Variable, Thread, DebugSession, BreakpointEvent,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { basename } from 'path-browserify';
import { TutelRuntime, FileAccessor, IRuntimeBreakpoint } from './tutelRuntime';
import { Subject } from 'await-notify';
import { extensionUri } from './activateTutelDebug';
import { createOrShowTerminal } from './tutelTerminal';


interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** run without debugging */
	noDebug?: boolean;
	/** if specified, results in a simulated compile error in launch. */
	compileError?: 'default' | 'show' | 'hide';
}

interface IAttachRequestArguments extends ILaunchRequestArguments { }


export class TutelDebugSession extends DebugSession {
	private _variableHandles = new Handles<'locals'>();
	private _configurationDone = new Subject();

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static threadID = 1;

	private _runtime: TutelRuntime;
	private _runInTreminal = false;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor(fileAccessor: FileAccessor) {
		super();

		// this debugger uses one-based lines and columns
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);

		if (vscode.window.activeTextEditor?.document.isUntitled) {
			vscode.window.showErrorMessage("The active file needs to be saved before it can be run");
			this.sendEvent(new TerminatedEvent());
		}

		const bufferUri = vscode.Uri.joinPath(extensionUri, 'media', 'buffer');
		this._runtime = new TutelRuntime(fileAccessor, bufferUri.fsPath);

		// setup event handlers
		this._runtime.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', TutelDebugSession.threadID));
		});
		this._runtime.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', TutelDebugSession.threadID));
		});
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', TutelDebugSession.threadID));
		});
		this._runtime.on('stopOnPause', () => {
			this.sendEvent(new StoppedEvent('pause', TutelDebugSession.threadID));
		});
		this._runtime.on('stopOnException', (exception) => {
			if (exception) {
				this.sendEvent(new StoppedEvent(`exception(${exception})`, TutelDebugSession.threadID));
			} else {
				this.sendEvent(new StoppedEvent('exception', TutelDebugSession.threadID));
			}
		});
		this._runtime.on('breakpointValidated', (bp: IRuntimeBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
		});
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): Promise<void> {
		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDone request.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code send exceptionInfo request
		response.body.supportsExceptionInfoRequest = true;

		// response.body.supportSuspendDebuggee = true;
		response.body.supportTerminateDebuggee = true;

		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsHitConditionalBreakpoints = true;

		this.sendResponse(response);
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
		this._runtime.terminate();
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments) {
		return this.launchRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		if (this._runInTreminal) {
			const name = "Tutel Debug Terminal";
			createOrShowTerminal(name);
			this.runInTerminalRequest(
				{ title: name, cwd: "", args: ['echo', 'test'], argsCanBeInterpretedByShell: true },
				5000,
				(response) => {
					console.log(JSON.stringify(response));
				})
		}

		await this._runtime.prepare(args.program);
		this.sendEvent(new InitializedEvent());

		await this._configurationDone.wait(1000);

		await this._runtime.start(!!args.stopOnEntry, !args.noDebug);

		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const path = args.source.path as string;
		const bps = args.breakpoints || [];

		this._runtime.clearAllBreakpoints(path);

		const actualBreakpoints0 = bps.map(async bp => {
			const { verified, line, id } = await this._runtime.setBreakPoint(
				path, this.convertClientLineToDebugger(bp.line), bp.condition 
			);
			const breakpoint = new Breakpoint(
				verified,
				this.convertDebuggerLineToClient(line),
				this.convertDebuggerLineToClient(1),
				this.createSource(path)
			) as DebugProtocol.Breakpoint;
			breakpoint.id = id;
			return breakpoint;
		});
		const actualBreakpoints = await Promise.all<DebugProtocol.Breakpoint>(actualBreakpoints0);

		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request | undefined): void {
		this._runtime.pause();
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(TutelDebugSession.threadID, "thread 1"),
			]
		};
		this.sendResponse(response);
	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const stk = await this._runtime.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.frames.map((f, ix) => {
				const sf: DebugProtocol.StackFrame = new StackFrame(
					f.index,
					f.name,
					this.createSource(f.file),
					this.convertDebuggerLineToClient(f.line),
					this.convertDebuggerColumnToClient(1)
					);
				return sf;
			}),
			totalFrames: stk.count
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		response.body = {
			scopes: [
				new Scope("Locals", this._variableHandles.create('locals'), false),
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void> {
		let vs: Variable[] = [];

		const v = this._variableHandles.get(args.variablesReference);
		if (v === 'locals') {
			vs = await this._runtime.getLocalVariables();
		}

		response.body = {
			variables: vs
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}

	protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
		await this._runtime.next();
		this.sendResponse(response);
	}

	protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
		await this._runtime. stepIn();
		this.sendResponse(response);
	}

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'tutel-adapter-data');
	}
}

