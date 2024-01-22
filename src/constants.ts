export const Methods = {
	ADD: "ADD",
	COLOR: "COLOR",
	POSITION: "POSITION",
	ORIENTATION: "ORIENTATION",
	GO: "GO",
	END: "END",
	FINISH: "FINISH",
}

export const DebuggerCommands = {
	SET_FILE: "file",
	RUN: "run",
	RUN_NO_DEBUG: "run_no_debug",
	CONTINUE: "continue",
	STEP_INTO: "step_into",
	STEP_OVER: "step_over",
	PAUSE: "pause",
	BREAKPOINT: "break",
	EXPR_BREAKPOINT: "break_expr",
	CLEAR: "clear",
	STACK: "stack",
	FRAME: "frame",
	EXIT: "exit",
}

export const DebuggerEvents = {
	STARTED: "started",
	CONTINUE: "resumed",
	STOP_ON_STEP_INTO: "StepInto",
	STOP_ON_STEP_OVER: "StepOver",
	STOP_ON_BP: "Breakpoint",
	STOP_ON_PAUSE: "Pause",
	END: "end",
	ALL_BP_REM: "all_breakpoints_removed",
	POST_MORTEM: "post_mortem",
}

export const DebuggerResponses = {
	FILE_SET: "file_set",
	RESUME: "resume",
	FRAME: "frame",
	STACK: "stack_trace",
	BPS: "breakpoints",
	BP_SET: "breakpoint_set",
	BP_CLEARED: "breakpoint_removed",
	ALL_BP_CLEARED: "all_breakpoints_removed",
	BAD_REQUEST: "bad_request",
}

export const DebuggerRequestSeparator = " ";