import React from 'react';

const SystemStatusCard = ({ healthScore = 105 }) => {
    return (
        <div className="p-6 bg-slate-900 rounded-xl border border-emerald-500/30 shadow-lg max-w-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wider">System Status</h3>
                <div className="h-3 w-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
            </div>

            <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-white">{healthScore}%</span>
                <span className="text-emerald-400 font-semibold">Healthy</span>
            </div>

            <p className="mt-4 text-slate-500 text-xs">
                Node: OpenClaw Echo • Gateway: 127.0.0.1
            </p>
        </div>
    );
};

export default SystemStatusCard;