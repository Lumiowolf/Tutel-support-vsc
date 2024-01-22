import * as vscode from 'vscode';
import { activateTutelDebug } from './activateTutelDebug';

export function activate(context: vscode.ExtensionContext) {
	activateTutelDebug(context);	// activateTutelDebug without 2nd argument launches the Debug Adapter "inlined"
}

export function deactivate() {
	// nothing to do
}
