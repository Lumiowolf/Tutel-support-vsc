export class Point {
	x: number = 0;
	y: number = 0;
}

export class Color {
	r: number = 0;
	g: number = 0;
	b: number = 0;
}

export class Turtle {
	color: Color = { r: 0, g: 0, b: 0 };
	position: Point = { x: 0, y: 0 };
	orientation: number = 0;
}

export class TutelWebviewRequestBody {
	color: Color | undefined;
	position: Point | undefined;
	orientation: number | undefined;
}

export class TutelWebviewRequest {
	method: string = "";
	id: number = -1;
	body: TutelWebviewRequestBody | undefined;
}

export class WrongTurtleIdError extends Error { }

export class TutelDebuggerResponse {
	type: string = "";
	body: object = {};

	static isOfType(obj: any): obj is TutelDebuggerResponse {
		return obj.type !== undefined && obj.body !== undefined;
	}
}

export class TutelDebuggerEvent {
	type: string = "";
	description: string = "";

	static isOfType(obj: any): obj is TutelDebuggerEvent {
		return obj.type !== undefined && obj.description !== undefined;
	}
}

export type TutelVariableType = string | number | boolean | null | Object | TutelVariableType[];

export class TutelFrame {
	name: string = "";
	lineno: number = 0;
	locals: Map<string, TutelVariableType> = new Map<string, TutelVariableType>();
}