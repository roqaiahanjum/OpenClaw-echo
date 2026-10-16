/**
 * Visualizer: Autonomous Data Visualization Engine
 * Generates stylized SVG strings for data insights.
 */
export class Visualizer {
    static generateBarChart(data: { label: string, value: number }[], title: string = "Data Insight"): string {
        const width = 600;
        const height = 400;
        const padding = 60;
        const barWidth = (width - 2 * padding) / data.length;
        const maxValue = Math.max(...data.map(d => d.value), 1);
        const scale = (height - 2 * padding) / maxValue;

        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
        
        // Background
        svg += `<rect width="100%" height="100%" fill="#0f172a" rx="12"/>`;
        
        // Title
        svg += `<text x="${width / 2}" y="30" text-anchor="middle" fill="#38bdf8" font-family="sans-serif" font-size="20" font-weight="bold">${title}</text>`;

        // Bars
        data.forEach((item, i) => {
            const barHeight = item.value * scale;
            const x = padding + i * barWidth;
            const y = height - padding - barHeight;
            
            // Bar
            svg += `<rect x="${x + 5}" y="${y}" width="${barWidth - 10}" height="${barHeight}" fill="url(#grad)" rx="4"/>`;
            
            // Label
            svg += `<text x="${x + barWidth / 2}" y="${height - padding + 20}" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="10">${item.label}</text>`;
            
            // Value
            svg += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="10" font-weight="bold">${item.value}</text>`;
        });

        // Gradient
        svg += `
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#38bdf8;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#818cf8;stop-opacity:1" />
                </linearGradient>
            </defs>
        `;

        svg += `</svg>`;
        return svg;
    }
}
