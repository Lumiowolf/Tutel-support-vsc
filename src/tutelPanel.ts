import * as vscode from 'vscode';
import * as fs from 'fs';
import { Methods } from './constants';
import { Color, Point, Turtle, TutelWebviewRequest, WrongTurtleIdError } from './types';
import { getNonce } from './utils';
import * as chokidar from 'chokidar';

export function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,

		// Keep content of webview loaded even if it is not currently displayed
		retainContextWhenHidden: true,

		// And restrict the webview to only loading content from our extension's `media` directory.
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
	};
}

/**
 * Manages tutel webview panels
 */
export class TutelPanel {
	/**
	 * Track the current panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: TutelPanel | undefined;

	public static readonly viewType = 'tutel';

	private turtles = new Map<number, Turtle>();

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	private watcher: chokidar.FSWatcher | null = null;
	// private bufferPath: string | null = null;

	public static createOrShow(extensionUri: vscode.Uri, bufferPath: string): TutelPanel {
		const column = vscode.window.activeTextEditor?.viewColumn
			? vscode.window.activeTextEditor.viewColumn + 1
			: undefined;

		// If we already have a panel, show it.
		if (TutelPanel.currentPanel) {
			TutelPanel.currentPanel._panel.reveal(column);
			TutelPanel.currentPanel.turtles = new Map<number, Turtle>();
			TutelPanel.currentPanel.watchFile(bufferPath);
			const webview = TutelPanel.currentPanel._panel.webview;
			TutelPanel.currentPanel._panel.webview.html = TutelPanel.currentPanel._getHtmlForWebview(webview);
			return TutelPanel.currentPanel;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			TutelPanel.viewType,
			'Tutel',
			column || vscode.ViewColumn.One,
			getWebviewOptions(extensionUri)
		);

		TutelPanel.currentPanel = new TutelPanel(panel, extensionUri);

		TutelPanel.currentPanel.watchFile(bufferPath);

		return TutelPanel.currentPanel;
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		TutelPanel.currentPanel = new TutelPanel(panel, extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this.turtles = new Map<number, Turtle>();

		// Set the webview's initial html content
		const webview = this._panel.webview;
		this._panel.webview.html = this._getHtmlForWebview(webview);

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
					case 'downloadImage':
						await this.handleImageDownload(message.imageUrl);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public addToDisposables(object: vscode.Disposable) {
		TutelPanel.currentPanel?._disposables.push(object);
	}

	public dispose() {
		TutelPanel.currentPanel?.watcher?.close();

		TutelPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public async watchFile(bufferPath: string) {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}

		this.watcher = chokidar.watch(bufferPath);

		let previousData = '';

		this.watcher.on('change', async (changedPath) => {
			try {
				const data = await fs.promises.readFile(changedPath, 'utf8');
				const newData = data.substring(previousData.length);
				if (newData.length) {
					await this.processWebviewRequests(newData.split('\n'));
				}
				previousData = data;
			} catch (err) {
				console.error(err);
			}
		});
	}

	private async handleImageDownload(dataUrl: string) {
		const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
		const buffer = Buffer.from(base64Data, 'base64');

		// Proś użytkownika o ścieżkę zapisu
		const uri = await vscode.window.showSaveDialog({
			filters: {
				'Images': ['png']
			}
		});

		if (uri) {
			// Zapisz obraz w wybranej przez użytkownika lokalizacji
			fs.promises.writeFile(uri.fsPath, buffer).then(() => {
				vscode.window.showInformationMessage('Image saved successfully!');
			}).catch(err => {
				vscode.window.showErrorMessage(`Error saving image: ${err.message}`);
			});
		} else {
			vscode.window.showInformationMessage('Image save cancelled.');
		}
	}

	private async processWebviewRequests(requests: string[]): Promise<void> {
		const deserializedRequests = this.deserializeWebviewRequests(requests);
		deserializedRequests.forEach((request) => {
			this.handleRequest(request);
		});
	}

	private deserializeWebviewRequests(requests: string[]): TutelWebviewRequest[] {
		let deserializedRequests = Array<TutelWebviewRequest>();
		requests.forEach((request) => {
			try {
				deserializedRequests.push(JSON.parse(request) as TutelWebviewRequest);
			} catch (err) {
				if (!(err instanceof SyntaxError)) { throw err };
			}
		});
		return deserializedRequests;
	}

	private handleRequest(request: TutelWebviewRequest) {
		if (request.method === Methods.ADD) {
			this.turtles.set(request.id, request.body as Turtle);
		}
		else {
			const turtle = this._getTurtleById(request.id);
			// if (request.method === Methods.FINISH) {
			// 	this.watcher?.close();
			// }
			if (request.method === Methods.COLOR) {
				turtle.color = request.body?.color !== undefined ? request.body.color : turtle.color;
			}
			else if (request.method === Methods.POSITION) {
				turtle.position = request.body?.position !== undefined ? request.body.position : turtle.position;
			}
			else if (request.method === Methods.ORIENTATION) {
				turtle.orientation = request.body?.orientation !== undefined ? request.body.orientation : turtle.orientation;
			}
			else if (request.method === Methods.GO) {
				const p0 = turtle.position;
				turtle.position = request.body?.position !== undefined ? request.body.position : turtle.position;
				const p1 = turtle.position;
				this._turtleMove(p0, p1, turtle.color);
			}
		}
	}

	private _getTurtleById(id: number) {
		const turtle = this.turtles.get(id);
		if (turtle === undefined) throw new WrongTurtleIdError(`No turtle of id ${id} was found`);
		return turtle;
	}

	private _turtleMove(p0: Point, p1: Point, color: Color) {
		const webview = this._panel.webview;
		webview.postMessage({ p0, p1, color });
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');

		// And the uri we use to load this script in the webview
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		// Local path to css styles
		const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
		const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css');

		// Uri to load styles into webview
		const stylesResetUri = webview.asWebviewUri(styleResetPath);
		const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">

				<title>Tutel</title>

			</head>
			<body>
				<div>
					<button id="downloadBtn">Pobierz obraz</button>
					<canvas	width="2000" height="2000" id="draw"></canvas>
				</div>
				<script nonce=${nonce} src=${scriptUri}></script>
			</body>
			</html>`;
	}
}