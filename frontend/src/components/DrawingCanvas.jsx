
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ==================== CONSTANTS ====================

const COLORS = [
  "#23213a",
  "#f15b45",
  "#ff9f43",
  "#f3c83c",
  "#47b881",
  "#37a6c8",
  "#7257d9",
  "#ec5ba5",
  "#ffffff",
];

// ==================== DRAWING HELPER ====================

function drawStroke(context, stroke, width, height) {
  const points = stroke.points || [];

  if (!points.length) return;

  context.save();

  // Drawing configuration
  context.globalCompositeOperation = "source-over";

  context.strokeStyle =
    stroke.tool === "eraser" ? "#ffffff" : stroke.color;

  context.fillStyle = context.strokeStyle;

  context.lineWidth = stroke.size * (width / 800);

  context.lineCap = "round";
  context.lineJoin = "round";

  // Draw a single point
  if (points.length === 1) {
    context.beginPath();

    context.arc(
      points[0].x * width,
      points[0].y * height,
      context.lineWidth / 2,
      0,
      Math.PI * 2
    );

    context.fill();
  } else {
    // Draw multiple connected points
    context.beginPath();

    context.moveTo(
      points[0].x * width,
      points[0].y * height
    );

    for (const point of points.slice(1)) {
      context.lineTo(
        point.x * width,
        point.y * height
      );
    }

    context.stroke();
  }

  context.restore();
}

// ==================== MAIN COMPONENT ====================

export default function DrawingCanvas({
  strokes,
  onAction,
  disabled,
}) {
  // -------------------- REFERENCES --------------------

  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef([]);

  // -------------------- STATE --------------------

  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(5);
  const [tool, setTool] = useState("pencil");

  // ==================== REDRAW CANVAS ====================

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    // Clear previous drawing
    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    // White background
    context.fillStyle = "#ffffff";

    context.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    // Render all received strokes
    for (const stroke of strokes) {
      drawStroke(
        context,
        stroke,
        canvas.width,
        canvas.height
      );
    }
  }, [strokes]);

  // ==================== CANVAS RESIZING ====================

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return undefined;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();

      const scale = window.devicePixelRatio || 1;

      // Adjust canvas resolution for screen density
      canvas.width = Math.max(
        1,
        Math.round(rect.width * scale)
      );

      canvas.height = Math.max(
        1,
        Math.round(rect.height * scale)
      );

      redraw();
    };

    const observer = new ResizeObserver(resize);

    observer.observe(canvas);

    resize();

    return () => observer.disconnect();
  }, [redraw]);

  // ==================== POINTER COORDINATES ====================

  const getPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();

    return {
      x: Math.max(
        0,
        Math.min(
          1,
          (event.clientX - rect.left) / rect.width
        )
      ),

      y: Math.max(
        0,
        Math.min(
          1,
          (event.clientY - rect.top) / rect.height
        )
      ),
    };
  };

  // ==================== PAINTING ====================

  const paintSegment = (points) => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    drawStroke(
      context,
      {
        points,
        color,
        size,
        tool,
      },
      canvas.width,
      canvas.height
    );
  };

  // -------------------- Start Drawing --------------------

  const start = (event) => {
    if (disabled) return;

    event.preventDefault();

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    drawingRef.current = true;

    pointsRef.current = [getPoint(event)];

    paintSegment(pointsRef.current);
  };

  // -------------------- Continue Drawing --------------------

  const move = (event) => {
    if (!drawingRef.current) return;

    const point = getPoint(event);

    const points = pointsRef.current;

    // Draw the latest segment
    paintSegment([
      points[points.length - 1],
      point,
    ]);

    points.push(point);

    // Send strokes in smaller batches
    if (points.length >= 24) {
      const lastPoint = points[points.length - 1];

      flushStroke();

      pointsRef.current = [lastPoint];
    }
  };

  // -------------------- Finish and Send Stroke --------------------

  const flushStroke = () => {
    if (!pointsRef.current.length) return;

    const stroke = {
      points: pointsRef.current,
      color,
      size,
      tool,
    };

    onAction("draw:stroke", stroke);

    pointsRef.current = [];
  };

  // -------------------- End Drawing --------------------

  const end = () => {
    if (!drawingRef.current) return;

    drawingRef.current = false;

    flushStroke();
  };

  // ==================== CANVAS ACTIONS ====================

  // Undo last stroke
  const undo = async () => {
    const result = await onAction("draw:undo");

    if (result?.ok) {
      redraw();
    }
  };

  // Clear entire canvas
  const clear = async () => {
    const result = await onAction("draw:clear");

    if (result?.ok) {
      redraw();
    }
  };

  // ==================== TOOL SELECTION ====================

  const selectColor = (selectedColor) => {
    setColor(selectedColor);
    setTool("pencil");
  };

  const selectTool = (selectedTool) => {
    setTool(selectedTool);
  };

  // ==================== RENDER ====================

  return (
    <div
      className={`canvas-wrap ${
        disabled ? "canvas-disabled" : ""
      }`}
    >

      {/* ==================== DRAWING AREA ==================== */}

      <canvas
        ref={canvasRef}
        aria-label="Shared drawing canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      />

      {/* ==================== CANVAS TOOLBAR ==================== */}

      {!disabled && (
        <div className="canvas-toolbar">

          {/* Color Palette */}

          <div className="palette">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Color ${value}`}
                className={`color-dot ${
                  color === value ? "selected" : ""
                }`}
                style={{
                  backgroundColor: value,
                }}
                onClick={() => selectColor(value)}
              />
            ))}
          </div>

          {/* Drawing Tools */}

          <div className="brush-tools">

            {/* Pencil */}

            <button
              type="button"
              className={`tool-button ${
                tool === "pencil" ? "tool-active" : ""
              }`}
              aria-label="Pencil"
              onClick={() => selectTool("pencil")}
            >
              ✏️
            </button>

            {/* Eraser */}

            <button
              type="button"
              className={`tool-button ${
                tool === "eraser" ? "tool-active" : ""
              }`}
              aria-label="Eraser"
              onClick={() => selectTool("eraser")}
            >
              ▱
            </button>

            {/* Brush Size */}

            <input
              aria-label="Brush size"
              type="range"
              min="2"
              max="24"
              value={size}
              onChange={(event) =>
                setSize(Number(event.target.value))
              }
            />

            {/* Undo */}

            <button
              type="button"
              className="tool-button"
              aria-label="Undo"
              onClick={undo}
            >
              ↶
            </button>

            {/* Clear Canvas */}

            <button
              type="button"
              className="tool-button"
              aria-label="Clear canvas"
              onClick={clear}
            >
              ⌫
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
