import { EventEmitter } from 'events';
import { TutelTerminal } from './tutelTerminal';
import { TutelPanel } from './tutelPanel';
import { extensionUri } from './activateTutelDebug';
import { TutelDebuggerResponse, TutelDebuggerEvent, TutelFrame, TutelVariableType } from './types';
import { Queue } from 'queue-typescript';
import { WebSocket } from 'ws';
import { DebuggerCommands, DebuggerEvents, DebuggerRequestSeparator, DebuggerResponses } from './constants';
import { Variable } from '@vscode/debugadapter';

export interface FileAccessor {
	isWindows: boolean;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export interface IRuntimeBreakpoint {
	id: number;
	line: number;
	verified: boolean;
	condition: string | undefined;
}

interface IRuntimeStackFrame {
	index: number;
	name: string;
	file: string;
	line: number;
	column?: number;
	instruction?: number;
}

interface IRuntimeStack {
	count: number;
	frames: IRuntimeStackFrame[];
}

export function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export class TutelRuntime extends EventEmitter {
	private _supportsRunInTerminal: boolean = false;

	public set supportsRunInTerminal(value: boolean) {
		this._supportsRunInTerminal = value;
	}

	public get shellArgs(): string[] {
		return [
			'python', '-m', 'Tutel.debugger',
			'--vscode',
			'-o', this._bufferPath ? `\"${this.normalizePathAndCasing(this._bufferPath)}\"` : "",
			'--port', this.debuggerPort
		];
	}

	private _bufferPath: string | undefined;

	private _debuggerPort: string | undefined = undefined;

	public get debuggerPort(): string {
		if (this._debuggerPort === undefined) {
			this._debuggerPort = "12345";
		}
		return this._debuggerPort;
	}

	private _websocket: WebSocket | undefined;
	private _responsesQueue: Queue<TutelDebuggerResponse> = new Queue();
	private _connectionReady: boolean = false;

	public get websocket() {
		return this._websocket;
	}

	private _sourceFile: string = '';
	public get sourceFile() {
		return this._sourceFile;
	}

	// maps from sourceFile to array of IRuntimeBreakpoint
	private breakPoints = new Map<string, IRuntimeBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private breakpointId = 1;


	constructor(private fileAccessor: FileAccessor, bufferPath: string) {
		super();
		this._bufferPath = bufferPath;
	}

	public async terminate(): Promise<void> {
		this.sendCommandToDebugger(DebuggerCommands.EXIT);
	}

	public async forceTerminate(): Promise<void> {
		if (this._connectionReady) {
			this.sendCommandToDebugger(DebuggerCommands.EXIT);
			await timeout(5000).then(() => {
				if (!this._connectionReady) {
					TutelTerminal.currentTerminal?.dispose();
				}
			})
			this.websocket?.close();
		}
	}

	public async prepare(program: string) {
		this._sourceFile = program;
		await this.initializeDebugger();
		if (this._bufferPath) {
			TutelPanel.createOrShow(extensionUri, this._bufferPath);
		}
		await this.connectToDebugger();
		await timeout(1000);
		program = this.normalizePathAndCasing(program);
		this.sendCommandToDebugger(DebuggerCommands.SET_FILE, [program]);
		await this.	getDebuggerResponse(DebuggerResponses.FILE_SET)
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	/**
	 * Start executing the given program.
	 */
	public async start(stopOnEntry: boolean, debug: boolean): Promise<void> {
		if (debug) {
			if (stopOnEntry) {
				this.sendCommandToDebugger(DebuggerCommands.STEP_INTO);
			}
			else {
				this.sendCommandToDebugger(DebuggerCommands.RUN);
			}
		} else {
			this.sendCommandToDebugger(DebuggerCommands.RUN_NO_DEBUG);
		}
		await this.getDebuggerResponse(DebuggerEvents.STARTED)
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	/**
	 * Continue execution to end/brakpoint.
	 */
	public async continue() {
		this.sendCommandToDebugger(DebuggerCommands.CONTINUE);
		await this.getDebuggerResponse(DebuggerResponses.RESUME)
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	/**
	 * "Step into" for Mock debug means: go to next character
	 */
	public async stepIn() {
		this.sendCommandToDebugger(DebuggerCommands.STEP_INTO);
		await this.getDebuggerResponse(DebuggerResponses.RESUME)
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	/**
	 * Step to the next non empty line.
	 */
	public async next() {
		this.sendCommandToDebugger(DebuggerCommands.STEP_OVER);
		await this.getDebuggerResponse(DebuggerResponses.RESUME)
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public async stack(startFrame: number, endFrame: number): Promise<IRuntimeStack> {
		const frames: IRuntimeStackFrame[] = [];

		this.sendCommandToDebugger(DebuggerCommands.STACK);
		await this.getDebuggerResponse(DebuggerResponses.STACK)
			.then((response) => {
				const stack = response.body["stack"] as TutelFrame[];
				const stackSize: number = stack.length;
				for (let i = startFrame; i < Math.min(endFrame, stackSize); i++) {

					const stackFrame: IRuntimeStackFrame = {
						index: i,
						name: stack[i]["name"],
						file: this._sourceFile,
						line: stack[i]["lineno"],
					};
					frames.push(stackFrame);
				}
			})
			.catch((reason) => {
				this.handleBadRequest(reason);
			});

		return {
			frames: frames,
			count: frames.length
		};
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public async setBreakPoint(path: string, line: number, condition: string | undefined = undefined): Promise<IRuntimeBreakpoint> {
		path = this.normalizePathAndCasing(path);

		let bps = this.breakPoints.get(path);
		if (!bps) {
			bps = new Array<IRuntimeBreakpoint>();
			this.breakPoints.set(path, bps);
		}
		const newBp: IRuntimeBreakpoint = { verified: false, line, id: this.breakpointId++, condition: condition };
		bps.push(newBp);

		await this.verifyBreakpoint(path, newBp);
		return newBp;
	}

	public checkBreakpoint(path: string, line: number): boolean {
		let exists = false;
		const bps = this.breakPoints.get(path);
		if (bps) {
			for (const bp of bps) {
				if (bp.line === line) exists = true;
			}
		}
		return exists;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public async clearBreakpoint(path: string, line: number): Promise<IRuntimeBreakpoint | undefined> {
		path = this.normalizePathAndCasing(path);
		const bps = this.breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				this.sendCommandToDebugger(DebuggerCommands.CLEAR, [path, line]);
				await this.getDebuggerResponse(DebuggerResponses.BP_CLEARED)
					.catch((reason) => {
						this.handleBadRequest(reason);
					});
				return bp;
			}
		}
		return undefined;
	}

	public async clearAllBreakpoints(path: string): Promise<void> {
		path = this.normalizePathAndCasing(path);
		this.breakPoints.delete(path);
		this.sendCommandToDebugger(DebuggerCommands.CLEAR, [path]);
		await this.getDebuggerResponse(DebuggerResponses.ALL_BP_CLEARED)
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	public pause(): void {
		this.sendCommandToDebugger(DebuggerCommands.PAUSE);
	}
	
	public async getLocalVariables(): Promise<Variable[]> {
		const variables = new Array<Variable>;

		this.sendCommandToDebugger(DebuggerCommands.FRAME, [0]);
		await this.getDebuggerResponse(DebuggerResponses.FRAME)
			.then((response) => {
				const frame = response.body["frame"] as TutelFrame;
				const rawVariables = frame.locals;
				for (const [key, _] of Object.entries(rawVariables)) {
					const value: TutelVariableType = rawVariables[key];
					variables.push({
						name: key,
						value: value ? JSON.stringify(value) : "",
						variablesReference: 0
					});
				}
			})
			.catch((reason) => {
				this.handleBadRequest(reason);
			});

		return variables;
	}

	// private methods

	private handleBadRequest(reason: string) {
		console.log(`bad request: ${reason}`);
		// this.sendEvent('stopOnException', reason);
	}

	private async verifyBreakpoint(path: string, bp: IRuntimeBreakpoint): Promise<void> {
		path = this.normalizePathAndCasing(path);
		if (bp.condition) {
			this.sendCommandToDebugger(DebuggerCommands.EXPR_BREAKPOINT, [path, bp.line, `"${bp.condition}"`]);
		}
		else {
			this.sendCommandToDebugger(DebuggerCommands.BREAKPOINT, [path, bp.line]);
		}
		await this.getDebuggerResponse(DebuggerResponses.BP_SET)
			.then((response) => {
				console.log(`${response.body["line"]} - ${bp.line}`);
				if (response.body["line"] === bp.line) {
					bp.verified = true;
					this.sendEvent('breakpointValidated', bp);
				}
			})
			.catch((reason) => {
				this.handleBadRequest(reason);
			});
	}

	private sendEvent(event: string, ...args: any[]): void {
		setTimeout(() => {
			this.emit(event, ...args);
		}, 0);
	}

	private normalizePathAndCasing(path: string) {
		if (this.fileAccessor.isWindows) {
			return path.replace(/\//g, '\\').toLowerCase();
		} else {
			return path.replace(/\\/g, '/');
		}
	}

	private async initializeDebugger(): Promise<void> {
		if (!this._supportsRunInTerminal && this._bufferPath) {
			TutelTerminal.create(extensionUri, this.shellArgs);
		}
	}

	private async connectToDebugger(): Promise<void> {
		const host = `ws://localhost:${this.debuggerPort}`;
		let socket = this.getWebSocket(host);
		let retries = 10;
		return new Promise<void>((resolve, reject) => {
			const interval = setInterval(() => {
				if (this._connectionReady) {
					clearInterval(interval);
					this._websocket = socket;
					resolve();
				}
				else {
					socket.removeAllListeners();
					socket.close();
					if (!retries--) {
						clearInterval(interval);
						reject();
					}

					socket = this.getWebSocket(host);
				}
			}, 1000);
		});
	}

	private getWebSocket(host: string): WebSocket {
		const socket = new WebSocket(host);
		socket.on('open', () => {
			socket.send('ACK');
			this._connectionReady = true;
		});

		socket.on('message', (message) => {
			const decodedMessage = message.toString("utf-8");
			const parsedResponse = TutelRuntime.parseDebuggerResponse(decodedMessage);
			if (parsedResponse instanceof TutelDebuggerEvent) {
				this.handleDebuggerEvent(parsedResponse);
			}
			else {
				this._responsesQueue.enqueue(parsedResponse);
			}
			socket.send("ACK");
		});

		socket.on('ping', (data) => {
			socket.pong(data);
		})

		socket.on('close', () => {
			this._connectionReady = false;
			this.sendEvent("end");
		});

		return socket;
	}

	private static parseDebuggerResponse(response: string): TutelDebuggerResponse | TutelDebuggerEvent {
		try {
			const obj = JSON.parse(response);
			if (TutelDebuggerResponse.isOfType(obj)) {
				return Object.assign(new TutelDebuggerResponse(), obj);
			}
			if (TutelDebuggerEvent.isOfType(obj)) {
				return Object.assign(new TutelDebuggerEvent(), obj);
			}
		} catch (err) {
			if (!(err instanceof SyntaxError)) { throw err };
		}
		return new TutelDebuggerResponse();
	}

	private handleDebuggerEvent(response: TutelDebuggerEvent) {
		if (response.type === DebuggerEvents.STOP_ON_BP) {
			this.sendEvent("stopOnBreakpoint");
		}
		else if (response.type === DebuggerEvents.STOP_ON_STEP_INTO) {
			this.sendEvent("stopOnEntry");
		}
		else if (response.type === DebuggerEvents.STOP_ON_STEP_OVER) {
			this.sendEvent("stopOnStep");
		}
		else if (response.type === DebuggerEvents.STOP_ON_PAUSE) {
			this.sendEvent("stopOnPause");
		}
		else if (response.type === DebuggerEvents.END) {
			this.sendCommandToDebugger(DebuggerCommands.EXIT);
		}
		else if (response.type === DebuggerEvents.ALL_BP_REM) {
		}
		else if (response.type === DebuggerEvents.POST_MORTEM) {
			this.sendEvent("stopOnException", response.description);
		}
	}

	private _buildDebuggerRequest(command: string, args?: Array<string | number>): string {
		const request = new Array<string>(command);
		if (args) {
			for (const arg of args) {
				request.push(arg.toString())
			}
		}
		return request.join(DebuggerRequestSeparator);
	}

	private sendCommandToDebugger(command: string, args?: Array<string | number>): boolean {
		const request = this._buildDebuggerRequest(command, args);
		console.log(`Sending ${JSON.stringify(request)}`)
		if (this._websocket && this._connectionReady) {
			this._responsesQueue = new Queue();
			this._websocket.send(request);
			return true;
		}
		return false;
	}

	private getDebuggerResponse(response: string): Promise<TutelDebuggerResponse> {
		return new Promise<TutelDebuggerResponse>((resolve, reject) => {
			const interval = setInterval(() => {
				if (this._responsesQueue.length !== 0) {
					clearInterval(interval);
					const message = this._responsesQueue.head;
					console.log(`Received ${JSON.stringify(message)}`);
					if (message.type === DebuggerResponses.BAD_REQUEST) {
						this._responsesQueue.dequeue();
						reject(message.body["msg"]);
					}
					if (message.type === response) {
						this._responsesQueue.dequeue();
						resolve(message);
					}
					else {
						reject();
					}
				}
			}, 100);
		});
	}
}
