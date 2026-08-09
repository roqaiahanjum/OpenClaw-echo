import streamlit as st
import sqlite3
import pandas as pd
import os
import time
from datetime import datetime

# --- PAGE CONFIG ---
st.set_page_config(
    page_title="OpenClaw-echo Admin",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- CUSTOM CSS ---
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
    }

    /* Main Container Background */
    .stApp {
        background-color: #F8FAFC;
    }

    /* Sidebar Styling */
    [data-testid="stSidebar"] {
        background: linear-gradient(180deg, #0F172A 0%, #1E1B4B 100%);
        color: white;
    }

    [data-testid="stSidebar"] * {
        color: white !important;
    }

    /* Navigation Links */
    .nav-item {
        padding: 10px 15px;
        border-radius: 8px;
        margin-bottom: 5px;
        cursor: pointer;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .nav-item:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .nav-active {
        background: rgba(255, 255, 255, 0.2);
        font-weight: 600;
    }

    /* Status Pill */
    .status-pill {
        background: rgba(34, 197, 94, 0.2);
        color: #4ADE80 !important;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 600;
        border: 1px solid rgba(34, 197, 94, 0.3);
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    /* Topbar Styling */
    .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 0;
        margin-bottom: 30px;
    }

    .deploy-btn {
        background: linear-gradient(90deg, #6366F1 0%, #A855F7 100%);
        color: white !important;
        padding: 10px 24px;
        border-radius: 8px;
        font-weight: 600;
        text-decoration: none;
        border: none;
        box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
    }

    /* Stat Cards Grid */
    .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
    }

    .stat-card {
        padding: 24px;
        border-radius: 16px;
        color: white;
        position: relative;
        overflow: hidden;
        box-shadow: 0 10px 20px rgba(0,0,0,0.05);
    }

    .card-purple { background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); }
    .card-green { background: linear-gradient(135deg, #10B981 0%, #3B82F6 100%); }
    .card-blue { background: linear-gradient(135deg, #3B82F6 0%, #2DD4BF 100%); }
    .card-orange { background: linear-gradient(135deg, #F59E0B 0%, #EF4444 100%); }

    .card-icon {
        font-size: 24px;
        margin-bottom: 15px;
        opacity: 0.9;
    }

    .card-value {
        font-size: 2rem;
        font-weight: 700;
        margin-bottom: 4px;
    }

    .card-label {
        font-size: 0.9rem;
        opacity: 0.8;
        font-weight: 500;
    }

    .card-trend {
        font-size: 0.75rem;
        background: rgba(255, 255, 255, 0.2);
        padding: 2px 8px;
        border-radius: 10px;
        margin-top: 10px;
        display: inline-block;
    }

    /* Activity Feed */
    .activity-section {
        background: white;
        padding: 24px;
        border-radius: 16px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    .activity-item {
        display: flex;
        align-items: center;
        padding: 16px 0;
        border-bottom: 1px solid #F1F5F9;
    }

    .activity-item:last-child {
        border-bottom: none;
    }

    .activity-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 15px;
    }

    .dot-purple { background-color: #8B5CF6; }
    .dot-blue { background-color: #3B82F6; }
    .dot-green { background-color: #10B981; }
    .dot-orange { background-color: #F59E0B; }

    .activity-info {
        flex-grow: 1;
    }

    .activity-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1E293B;
    }

    .activity-time {
        font-size: 0.8rem;
        color: #64748B;
    }

    /* Hide Streamlit components we don't want */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

# --- DATA HELPERS ---
def get_stats():
    # Placeholder for actual DB logic
    return {
        "messages": "1,284",
        "users": "42",
        "memories": "892",
        "uptime": "99.9%"
    }

def get_activities():
    return [
        {"type": "purple", "title": "Memory stored: 'User preference updated'", "time": "2 mins ago"},
        {"type": "blue", "title": "Telegram message sent to @user123", "time": "15 mins ago"},
        {"type": "green", "title": "API call made: Tavily Search (Success)", "time": "1 hour ago"},
        {"type": "orange", "title": "Email sent: Project Summary Report", "time": "3 hours ago"},
        {"type": "purple", "title": "System Reboot: Performance Optimized", "time": "Yesterday"},
    ]

# --- SIDEBAR ---
with st.sidebar:
    st.markdown("""
    <div style="padding: 20px 0; margin-bottom: 20px;">
        <h2 style="margin:0; font-size: 1.5rem; letter-spacing: -0.5px;">🤖 OpenClaw-echo</h2>
        <p style="margin:0; font-size: 0.8rem; opacity: 0.6;">Admin Control Center</p>
    </div>
    """, unsafe_allow_html=True)
    
    # Navigation
    st.markdown('<div class="nav-item nav-active">📊 Dashboard</div>', unsafe_allow_html=True)
    st.markdown('<div class="nav-item">🧠 Memory Explorer</div>', unsafe_allow_html=True)
    st.markdown('<div class="nav-item">📜 System Logs</div>', unsafe_allow_html=True)
    st.markdown('<div class="nav-item">📈 Usage Stats</div>', unsafe_allow_html=True)
    st.markdown('<div class="nav-item">⚙️ Settings</div>', unsafe_allow_html=True)
    
    # Database Status (Pinned to bottom-ish)
    st.markdown("<br><br><br>", unsafe_allow_html=True)
    st.markdown("""
    <div class="status-pill">
        <div style="width: 8px; height: 8px; background: #4ADE80; border-radius: 50%;"></div>
        Database: Connected
    </div>
    """, unsafe_allow_html=True)

# --- MAIN CONTENT ---
stats = get_stats()

# Topbar
st.markdown(f"""
<div class="topbar">
    <h1 style="margin:0; font-size: 1.8rem; font-weight: 700; color: #1E293B;">Dashboard</h1>
    <a href="#" class="deploy-btn">🚀 Deploy Changes</a>
</div>
""", unsafe_allow_html=True)

# Stat Cards
st.markdown(f"""
<div class="card-grid">
    <div class="stat-card card-purple">
        <div class="card-icon">💬</div>
        <div class="card-value">{stats['messages']}</div>
        <div class="card-label">Total Messages</div>
        <div class="card-trend">📈 +12.5% this week</div>
    </div>
    <div class="stat-card card-green">
        <div class="card-icon">👥</div>
        <div class="card-value">{stats['users']}</div>
        <div class="card-label">Active Users</div>
        <div class="card-trend">🔥 5 new today</div>
    </div>
    <div class="stat-card card-blue">
        <div class="card-icon">🧠</div>
        <div class="card-value">{stats['memories']}</div>
        <div class="card-label">Stored Memories</div>
        <div class="card-trend">🔄 Updated 5m ago</div>
    </div>
    <div class="stat-card card-orange">
        <div class="card-icon">⚡</div>
        <div class="card-value">{stats['uptime']}</div>
        <div class="card-label">System Uptime</div>
        <div class="card-trend">✅ All systems go</div>
    </div>
</div>
""", unsafe_allow_html=True)

# Recent Activity
st.markdown("""
<div class="activity-section">
    <h3 style="margin:0 0 20px 0; font-size: 1.1rem; font-weight: 600; color: #1E293B;">Recent Activity Feed</h3>
""", unsafe_allow_html=True)

for act in get_activities():
    st.markdown(f"""
    <div class="activity-item">
        <div class="activity-dot dot-{act['type']}"></div>
        <div class="activity-info">
            <div class="activity-title">{act['title']}</div>
            <div class="activity-time">{act['time']}</div>
        </div>
    </div>
    """, unsafe_allow_html=True)

st.markdown("</div>", unsafe_allow_html=True)

# Footer/Spacing
st.markdown("<br><br>", unsafe_allow_html=True)