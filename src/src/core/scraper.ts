import * as cheerio from "cheerio";
import axios from "axios";
import { isSafePublicUrl } from "../skills/tools";

/**
 * Scraper: Deep Web Exploration Engine
 * Fetches and cleans web pages to extract readable content with SSRF protection.
 */
export class Scraper {
    static async fetchCleanText(url: string): Promise<string> {
        const safety = isSafePublicUrl(url);
        if (!safety.safe) {
            throw new Error(`Safety Error: Access to URL blocked by SSRF guard (${safety.reason})`);
        }

        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9'
                },
                timeout: 10000,
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 300
            });

            const html = response.data;
            if (typeof html !== "string") {
                return String(html || "");
            }

            const $ = cheerio.load(html);

            // Remove non-content elements
            $('script').remove();
            $('style').remove();
            $('noscript').remove();
            $('nav').remove();
            $('footer').remove();
            $('header').remove();
            $('aside').remove();
            $('iframe').remove();
            $('svg').remove();

            // Extract main content by prioritizing body or main tags
            const contentNode = $('main').length ? $('main') : $('body');
            
            // Extract text and clean up whitespace
            let text = contentNode.text();
            text = text.replace(/\s+/g, ' ').trim();

            return text;
        } catch (error: any) {
            if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                throw new Error(`Failed to scrape ${url}: Request timed out after 10s.`);
            }
            if (error.response) {
                throw new Error(`Failed to scrape ${url}: HTTP Error ${error.response.status} (${error.response.statusText || 'Request failed'}).`);
            }
            throw new Error(`Failed to scrape ${url}: ${error.message}`);
        }
    }
}

