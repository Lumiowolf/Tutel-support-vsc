'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { TutelDebugSession } from './tutelDebug';
import { FileAccessor } from './tutelRuntime';

export let extensionUri: vscode.Uri;

export function activateTutelDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {
	extensionUri = context.extensionUri;

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.tutel.runEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'tutel',
					name: 'Run File',
					request: 'launch',
					program: targetResource.fsPath
				},
					{ noDebug: true }
				);
			}
		}),
		vscode.commands.registerCommand('extension.tutel.debugEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'tutel',
					name: 'Debug File',
					request: 'launch',
					program: targetResource.fsPath,
					stopOnEntry: false
				});
			}
		}),
		vscode.commands.registerCommand('extension.tutel.toggleFormatting', (variable) => {
			const ds = vscode.debug.activeDebugSession;
			if (ds) {
				ds.customRequest('toggleFormatting');
			}
		})
	);

	context.subscriptions.push(vscode.commands.registerCommand('extension.tutel.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of tutel code file in the workspace folder",
			value: vscode.window.activeTextEditor?.document.fileName
		});
	}));

	// register a configuration provider for 'tutel' debug type
	const provider = new TutelConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('tutel', provider));

	if (!factory) {
		factory = new InlineDebugAdapterFactory();
	}
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('tutel', factory));
	if ('dispose' in factory) {
		// @ts-ignore
		context.subscriptions.push(factory);
	}
}

class TutelConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'tutel') {
				config.type = 'tutel';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = false;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

export const workspaceFileAccessor: FileAccessor = {
	isWindows: false,
	async readFile(path: string): Promise<Uint8Array> {
		let uri: vscode.Uri;
		try {
			uri = pathToUri(path);
		} catch (e) {
			return new TextEncoder().encode(`cannot read '${path}'`);
		}

		return await vscode.workspace.fs.readFile(uri);
	},
	async writeFile(path: string, contents: Uint8Array) {
		await vscode.workspace.fs.writeFile(pathToUri(path), contents);
	}
};

function pathToUri(path: string) {
	try {
		return vscode.Uri.file(path);
	} catch (e) {
		return vscode.Uri.parse(path);
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new TutelDebugSession(workspaceFileAccessor));
	}
}
