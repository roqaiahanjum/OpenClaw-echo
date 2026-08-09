/**
 * Fast Conversational Message Guard
 * Identifies simple conversational prompts that do not require tool calls or multi-step execution.
 */
export function isSimpleConversation(input: string): boolean {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    const words = lower.split(/\s+/);

    // 1. Explicit conversational phrases
    const conversationalPhrases = [
        "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
        "how are you", "how are you doing", "whats up", "who are you",
        "what is your name", "what is your system name", "thank you", "thanks",
        "bye", "goodbye", "see you", "nice to meet you", "how do you do"
    ];

    if (conversationalPhrases.includes(lower)) {
        return true;
    }

    // 2. Action & Tool keywords that MUST go through autonomous tool loop
    const actionKeywords = [
        "search", "find", "look up", "calculate", "send", "create",
        "research", "compare", "analyze", "audit", "time", "weather",
        "fetch", "scrape", "run", "execute", "git", "email", "news"
    ];

    for (const kw of actionKeywords) {
        if (lower.includes(kw)) {
            return false;
        }
    }

    // 3. Very short greetings or chatter without action verbs (1-3 words)
    if (words.length <= 3 && !actionKeywords.some(kw => lower.includes(kw))) {
        return true;
    }

    return false;
}
