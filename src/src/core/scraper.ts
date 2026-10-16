import * as cheerio from "cheerio";
import axios from "axios";

/**
 * Scraper: Deep Web Exploration Engine
 * Fetches and cleans web pages to extract readable content.
 */
export class Scraper {
    static async fetchCleanText(url: string): Promise<string> {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 10000
            });

            const html = response.data;
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
            throw new Error(`Failed to scrape ${url}: ${error.message}`);
        }
    }
}
