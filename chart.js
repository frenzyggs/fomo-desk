// Handmade <canvas> helpers. Real charts are a later step; this draws a placeholder or a simple line.
window.DeskChart = {
  draw(canvas, points) {
    const c = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);
    if (!points || points.length < 2) {
      c.fillStyle = "#8e8e93"; c.font = "16px -apple-system,sans-serif"; c.textAlign = "center";
      c.fillText("No chart data yet", w / 2, h / 2); return;
    }
    const ys = points.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys) || 1;
    c.strokeStyle = "#30d158"; c.lineWidth = 2; c.beginPath();
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * w, y = h - ((p[1] - lo) / ((hi - lo) || 1)) * (h - 10) - 5;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();
  }
};
