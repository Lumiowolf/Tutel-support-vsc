(function () {
    let canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("draw"));
    let ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

    let cameraOffset = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let cameraZoom = 1;
    const MAX_ZOOM = 10;
    const MIN_ZOOM = 0.5;
    const SCROLL_SENSITIVITY = 0.0005;
    const LINE_WIDTH = 10;
    ctx.lineWidth = LINE_WIDTH;

    class Point {
        constructor(x = 0, y = 0) {
            this.x = x;
            this.y = y;
        }
    }

    class Color {
        constructor(r = 0, g = 0, b = 0) {
            this.r = r;
            this.g = g;
            this.b = b;
        }
    }

    let lines = /** @type {Array<{p0: Point, p1: Point, color: Color}}>} */ new Array();

    function draw() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Apply transformations only once
        ctx.translate(
            canvas.width / 2 - cameraOffset.x * cameraZoom,
            canvas.height / 2 - cameraOffset.y * cameraZoom
        );
        ctx.scale(cameraZoom, cameraZoom);

        lines.forEach((line) => {
            ctx.beginPath();
            ctx.moveTo(line.p0.x, line.p0.y);
            ctx.lineTo(line.p1.x, line.p1.y);
            ctx.strokeStyle = `rgb(${line.color.r}, ${line.color.g}, ${line.color.b})`;
            ctx.stroke();
        });

        requestAnimationFrame(draw);
    }

    function getEventLocation(/** @type {MouseEvent} */ e) {
        if (e.clientX && e.clientY) {
            return { x: e.clientX, y: e.clientY };
        }
    }

    let isDragging = false;
    let dragStart = new Point();

    function onPointerDown(/** @type {MouseEvent} */ e) {
        isDragging = true;
        const eventLocation = getEventLocation(e);
        if (eventLocation) {
            dragStart.x = eventLocation.x / cameraZoom - cameraOffset.x;
            dragStart.y = eventLocation.y / cameraZoom - cameraOffset.y;
        }
    }

    function onPointerUp() {
        isDragging = false;
    }

    function onPointerMove(/** @type {MouseEvent} */ e) {
        if (isDragging) {
            const eventLocation = getEventLocation(e);
            if (eventLocation) {
                cameraOffset.x = eventLocation.x / cameraZoom - dragStart.x;
                cameraOffset.y = eventLocation.y / cameraZoom - dragStart.y;
            }
        }
    }

    function adjustZoom(/** @type {number} */ zoomAmount, /** @type {number} */ zoomFactor) {
        if (!isDragging) {
            cameraZoom -= zoomAmount || 0;
            if (zoomFactor) {
                cameraZoom = zoomFactor * cameraZoom;
            }

            cameraZoom = Math.min(cameraZoom, MAX_ZOOM);
            cameraZoom = Math.max(cameraZoom, MIN_ZOOM);
        }
    }

    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('wheel', (e) => adjustZoom(e.deltaY * SCROLL_SENSITIVITY));

    window.addEventListener('message', event => {
        const message = event.data;
        lines.push(message);
    });

    draw();
}());