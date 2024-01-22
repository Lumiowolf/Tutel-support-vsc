import * as vscode from 'vscode';


export function createOrShowTerminal(name: string): vscode.Terminal {
	const existingTerminal = vscode.window.terminals.find(t => t.name === name);

	if (existingTerminal) {
		existingTerminal.show();
		existingTerminal.dispose()
		// return existingTerminal;
	}
	// else {
	const terminalOptions: vscode.TerminalOptions = {
		name: name,
		hideFromUser: false,
	}
	const newTerminal = vscode.window.createTerminal(terminalOptions);
	newTerminal.show();
	return newTerminal;
	// }
}

export class TutelTerminal {
	public static currentTerminal: TutelTerminal | undefined;
	private readonly _terminal: vscode.Terminal;

	public get terminal() {
		return this._terminal;
	}

	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	public get extensionUri(): vscode.Uri {
		return this._extensionUri;
	}

	public static create(extensionUri: vscode.Uri, shellArgs: string[]) {
		const terminal = createOrShowTerminal("Tutel debug console");
		terminal.sendText(`${shellArgs.join(' ')}`);

		TutelTerminal.currentTerminal = new TutelTerminal(terminal, extensionUri);
	}

	public static revive(terminal: vscode.Terminal, extensionUri: vscode.Uri) {
		TutelTerminal.currentTerminal = new TutelTerminal(terminal, extensionUri);
	}

	public static isTutelTerminal(terminal: vscode.Terminal) {
		return terminal === this.currentTerminal?._terminal;
	}

	private constructor(terminal: vscode.Terminal, extensionUri: vscode.Uri) {
		this._terminal = terminal;
		this._extensionUri = extensionUri;
	}

	public dispose() {
		TutelTerminal.currentTerminal = undefined;

		// Clean up our resources
		this._terminal.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}