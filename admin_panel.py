import streamlit as st
import sqlite3
import pandas as pd
import os
import time

# --- CONFIGURATION ---
DB_NAME = "vector.db"
LOG_FILE = "app.log"
GEMINI_LIMIT = 1000
TAVILY_LIMIT = 1000

# --- UI STYLING & PAGE CONFIG ---
st.set_page_config(page_title="OpenClaw Echo Admin", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
    .main { background-color: #0e1117; color: #ffffff; }
    .stMetric { background-color: #1f2937; padding: 15px; border-radius: 10px; }
    .log-error { color: #ff4b4b; font-weight: bold; }
    .log-search { color: #00fa9a; font-weight: bold; }
</style>
""", unsafe_allow_html=True)

# --- HELPER FUNCTIONS ---
def get_db_connection():
    try:
        return sqlite3.connect(DB_NAME)
    except Exception as e:
        return None

def fetch_all_memories():
    """1. Memory Tab: Fetch all rows from the 'memories' table"""
    conn = get_db_connection()
    if conn is None:
        return None
    try:
        df = pd.read_sql_query("SELECT * FROM memories", conn)
        return df
    except Exception:
        # Table might not exist yet
        return None
    finally:
        if conn:
            conn.close()

def get_usage_metrics():
    """Extract metrics safely from the log file"""
    if not os.path.exists(LOG_FILE):
        return 0, 0
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            content = f.read()
        gemini_calls = content.count("[Gemini]")
        tavily_calls = content.count("[Tavily Search]")
        return gemini_calls, tavily_calls
    except Exception:
        return 0, 0

# --- SIDEBAR ---
st.sidebar.title("🤖 System Overview")
if os.path.exists(DB_NAME):
    st.sidebar.success("🟢 Database: Connected")
else:
    st.sidebar.error("🔴 Database: Disconnected")

# --- MAIN TABS ---
st.title("OpenClaw-echo Admin Dashboard")
tab1, tab2, tab3 = st.tabs(["🧠 Memory Explorer", "📜 System Logs", "📊 Usage Stats"])

# --- TAB 1: MEMORY EXPLORER ---
with tab1:
    st.header("Stored Memories")
    if os.path.exists(DB_NAME):
        df_memories = fetch_all_memories()
        
        if df_memories is None:
            st.info("No memories stored yet or table uninitialized.")
        elif df_memories.empty:
            st.info("No memories stored yet.")
        else:
            # Interactive dataframe
            st.dataframe(df_memories, use_container_width=True)
    else:
        st.warning(f"Expected database '{DB_NAME}' not found.")

# --- TAB 2: SYSTEM LOGS ---
with tab2:
    st.header("Live Log Viewer")
    live_toggle = st.toggle("Activate Live Mode (Auto-Refresh)")
    log_placeholder = st.empty()
    
    # 2. Logs Tab: A live log viewer with a while True loop and st.empty()
    if live_toggle:
        while True:
            log_content = ""
            try:
                if os.path.exists(LOG_FILE):
                    with open(LOG_FILE, "r", encoding="utf-8") as f:
                        lines = f.readlines()[-50:]  # Last 50 lines
                        
                        for line in lines:
                            if "[Error]" in line:
                                log_content += f"<span class='log-error'>{st.utils.escape(line)}</span><br>"
                            elif "[Search]" in line:
                                log_content += f"<span class='log-search'>{st.utils.escape(line)}</span><br>"
                            else:
                                log_content += f"{st.utils.escape(line)}<br>"
                else:
                    log_content = "Waiting for 'app.log' to be created..."
                    
                log_placeholder.markdown(f"<div style='font-family: monospace; background-color: #1e1e1e; padding: 10px; border-radius: 5px; height: 500px; overflow-y: scroll;'>{log_content}</div>", unsafe_allow_html=True)
                
            except Exception as e:
                log_placeholder.error(f"Error reading logs: {str(e)}")
                
            time.sleep(5)
    else:
        log_placeholder.info("Activate the toggle above to start the live log stream.")


# --- TAB 3: USAGE STATS ---
with tab3:
    st.header("API Consumption")
    
    gemini_calls, tavily_calls = get_usage_metrics()
    
    # 3. Usage Tab: Create two columns
    col1, col2 = st.columns(2)
    
    with col1:
        st.metric("Gemini Calls", f"{gemini_calls} / {GEMINI_LIMIT}")
        gemini_pct = min(gemini_calls / GEMINI_LIMIT, 1.0)
        
        # Turn red if exceeds 90%
        if gemini_pct > 0.9:
            st.markdown("""<style>.stProgress > div > div > div > div { background-color: red; }</style>""", unsafe_allow_html=True)
            st.error("⚠️ Gemini Quota Nearing Limit!")
        st.progress(gemini_pct)
        
    with col2:
        st.metric("Tavily Calls", f"{tavily_calls} / {TAVILY_LIMIT}")
        tavily_pct = min(tavily_calls / TAVILY_LIMIT, 1.0)
        
        # Turn red if exceeds 90%
        if tavily_pct > 0.9:
            st.markdown("""<style>.stProgress > div > div > div > div { background-color: red; }</style>""", unsafe_allow_html=True)
            st.error("⚠️ Tavily Quota Nearing Limit!")
        st.progress(tavily_pct)