(function () {
    const vscode = acquireVsCodeApi();

    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("draw"));
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

    let cameraOffset = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let cameraZoom = 1;
    const MAX_ZOOM = 100;
    const MIN_ZOOM = 0.05;
    const SCROLL_SENSITIVITY = 0.0005;
    const LINE_WIDTH = 10;
    ctx.lineWidth = LINE_WIDTH;

    class Point {
        /** @type {number} */ x = 0;
        /** @type {number} */ y = 0;
    }

    class Color {
        /** @type {number} */ r = 0;
        /** @type {number} */ g = 0;
        /** @type {number} */ b = 0;
    }

    let lines = /** @type {Array<{p0: Point, p1: Point, color: Color}}>} */ new Array();

    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn?.addEventListener('click', function () {
        const scaleFactor = 10; // Zwiększ ten współczynnik dla wyższej rozdzielczości
        // const extraZoom = 2.5; // Dodatkowy współczynnik oddalenia
        const tempCanvas = document.createElement("canvas");
        const tempCtx = tempCanvas.getContext("2d");
    
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
    
        const scaledWidth = canvasWidth * scaleFactor;
        const scaledHeight = canvasHeight * scaleFactor;
    
        // const scaledOffsetX = cameraOffset.x * scaleFactor * extraZoom;
        // const scaledOffsetY = cameraOffset.y * scaleFactor * extraZoom;
        const scaledOffsetX = cameraOffset.x * scaleFactor;
        const scaledOffsetY = cameraOffset.y * scaleFactor;
    
        tempCanvas.width = scaledWidth;
        tempCanvas.height = scaledHeight;
    
        if (tempCtx) {
            // tempCtx.lineWidth = LINE_WIDTH * scaleFactor;
            tempCtx.lineWidth = tempCtx.lineWidth * scaleFactor;
            tempCtx.translate(scaledWidth / 2, scaledHeight / 2);
            tempCtx.scale(cameraZoom, cameraZoom);
            tempCtx.translate(-scaledWidth / 2 + scaledOffsetX, -scaledHeight / 2 + scaledOffsetY);
    
            lines.forEach((line) => {
                tempCtx.beginPath();
                tempCtx.moveTo(line.p0.x * scaleFactor, line.p0.y * scaleFactor);
                tempCtx.lineTo(line.p1.x * scaleFactor, line.p1.y * scaleFactor);
                tempCtx.strokeStyle = `rgb(${line.color.r}, ${line.color.g}, ${line.color.b})`;
                tempCtx.stroke();
            });
    
            const imageUrl = tempCanvas.toDataURL('image/png');
            const data = {
                command: 'downloadImage',
                imageUrl: imageUrl
            };
    
            vscode.postMessage(data);
        }
    });

    // const downloadBtn = document.getElementById('downloadBtn');
    // downloadBtn?.addEventListener('click', function () {
    //     const scaleFactor = 8; // Zwiększ ten współczynnik dla wyższej rozdzielczości
    //     const tempCanvas = document.createElement("canvas");
    //     const tempCtx = tempCanvas.getContext("2d");

    //     tempCanvas.width = canvas.width * scaleFactor;
    //     tempCanvas.height = canvas.height * scaleFactor;

    //     if (tempCtx) {
    //         // tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    //         // tempCtx.scale(cameraZoom, cameraZoom);
    //         // tempCtx.translate(-tempCanvas.width / 2 + cameraOffset.x * scaleFactor, -tempCanvas.height / 2 + cameraOffset.y * scaleFactor);

    //         lines.forEach((line) => {
    //             tempCtx.beginPath();
    //             tempCtx.moveTo(line.p0.x, line.p0.y);
    //             tempCtx.lineTo(line.p1.x, line.p1.y);
    //             tempCtx.strokeStyle = `rgb(${line.color.r}, ${line.color.g}, ${line.color.b})`;
    //             tempCtx.stroke();
    //         });
    //         tempCtx.scale(scaleFactor * cameraZoom, scaleFactor * cameraZoom);
    //         // tempCtx.translate(-tempCanvas.width / 2 + cameraOffset.x * scaleFactor, -tempCanvas.height / 2 + cameraOffset.y * scaleFactor);

    //     }
    //     // tempCtx?.drawImage(canvas, 0, 0);

    //     const imageUrl = tempCanvas.toDataURL('image/png');
    //     const data = {
    //         command: 'downloadImage',
    //         imageUrl: imageUrl
    //     };

    //     vscode.postMessage(data);
    // });

    function draw() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Translate to the canvas centre before zooming - so you'll always zoom on what you're looking directly at
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(cameraZoom, cameraZoom);
        ctx.translate(-canvas.width / 2 + cameraOffset.x, -canvas.height / 2 + cameraOffset.y);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        lines.forEach((line) => {
            ctx.beginPath();
            ctx.moveTo(line.p0.x, line.p0.y);
            ctx.lineTo(line.p1.x, line.p1.y);
            ctx.strokeStyle = `rgb(${line.color.r}, ${line.color.g}, ${line.color.b})`;
            ctx.stroke();
        });

        requestAnimationFrame(draw);
    }

    // Gets the relevant location from a single touch event
    function getEventLocation(/** @type {MouseEvent} */ e) {
        if (e.clientX && e.clientY) {
            return { x: e.clientX, y: e.clientY };
        }
    }

    let isDragging = false;
    let dragStart = { x: 0, y: 0 };

    function onPointerDown(/** @type {MouseEvent} */ e) {
        isDragging = true;
        const eventLocation = getEventLocation(e);
        if (eventLocation) {
            dragStart.x = eventLocation.x / cameraZoom - cameraOffset.x;
            dragStart.y = eventLocation.y / cameraZoom - cameraOffset.y;
        }
    }

    function onPointerUp(/** @type {MouseEvent} */ e) {
        isDragging = false;
        lastZoom = cameraZoom;
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

    let lastZoom = cameraZoom;

    function adjustZoom(/** @type {number} */ zoomAmount, /** @type {number} */ zoomFactor) {
        if (!isDragging) {
            if (zoomAmount) {
                cameraZoom -= zoomAmount;
            }
            else if (zoomFactor) {
                cameraZoom = zoomFactor * lastZoom;
            }
            cameraZoom = Math.min(cameraZoom, MAX_ZOOM);
            cameraZoom = Math.max(cameraZoom, MIN_ZOOM);
        }
    }

    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        adjustZoom(e.deltaY * SCROLL_SENSITIVITY)
    }, { passive: false });

    window.addEventListener('message', event => {
        const message = event.data;
        lines.push(message);
    });
    draw();
}());