# **App Name**: DISCERN Insights

## Core Features:

- URL Import: Import a list of URLs from pasted text or uploaded CSV/XLS files, normalising and de-duplicating them.
- Content Eligibility Check: Fetch content from each URL (ignoring robots.txt), determine content type (text, PDF, video), and extract the main textual content if eligible, filtering non-text contents and registering the reason for non-analysis.
- Content Summarization: Summarize text content exceeding 30k characters using AI to retain relevant information, focusing on treatment, risks, and sources.
- DISCERN Analysis: Apply the 16 DISCERN items to the extracted text via a prompt tool, generating scores, justifications, domain averages, executive summaries, observations, and recommendations.
- Report Generation & Display: Display a formatted DISCERN report (in Markdown) with status, scores, justifications, summaries, and recommendations, with a button to copy the report content.
- Automated/Assisted Processing: Provide toggle between assisted mode (confirm before processing each URL) and automatic mode (process all URLs in sequence).
- Data Export: Enable export of the processed data in CSV or JSON format.

## Style Guidelines:

- Primary color: Deep Indigo (#3F51B5) to evoke a sense of trust and intellect.
- Background color: Light gray (#F5F5F5), providing a clean, neutral base.
- Accent color: Teal (#009688) for interactive elements and highlights, ensuring contrast and visibility.
- Body and headline font: 'Inter', a sans-serif font known for its readability and modern appearance, suitable for both headlines and body text.
- Use minimalist, clear icons to represent different actions and statuses (e.g., processing, completed, error).
- A clean, responsive layout with a focus on content hierarchy. Use clear sections for URL input, processing queue, and results display.
- Subtle animations for loading states and transitions, providing feedback to the user without being distracting.