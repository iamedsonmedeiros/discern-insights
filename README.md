# DISCERN Insights

DISCERN Insights is an AI-powered web application designed to automate the quality analysis of online health information using the validated DISCERN methodology. The tool enables researchers, medical professionals, and content creators to efficiently process large volumes of web pages, evaluate them against the 16 DISCERN criteria, and generate detailed reports, including a publication-ready scientific article.

The application is built with a modern web stack, leveraging Next.js for the frontend and server-side logic, and Google's Genkit for its powerful AI capabilities.

## Core Features

*   **URL Import**: Import URLs for analysis by pasting a list directly into a textarea or by uploading a `.csv` file. The application automatically deduplicates URLs.
*   **Content Eligibility & Extraction**:
    *   Fetches content from each URL by simulating a Google Bot to bypass `robots.txt` restrictions.
    *   Identifies and filters out non-eligible content like PDFs and videos.
    *   Extracts clean, readable text from the HTML of eligible pages.
*   **AI-Powered Summarization**: For articles with text content exceeding 30,000 characters, the tool uses an AI flow to summarize the content, ensuring the core information is retained for analysis.
*   **DISCERN Analysis**:
    *   An AI flow evaluates the extracted text against the 16 items of the DISCERN instrument.
    *   Generates a score (1-5) and a detailed justification for each of the 16 items.
    *   Produces an executive summary, key observations, and actionable recommendations for improvement.
*   **Processing Control**:
    *   **Automatic Mode**: Process the entire queue of URLs sequentially without user intervention.
    *   **Manual Mode**: Process one URL at a time, allowing the user to trigger the next analysis.
    *   The ability to start, pause, and continue the analysis queue.
*   **Internationalization (i18n)**: The entire user interface and AI analysis output are available in both **English (en)** and **Brazilian Portuguese (pt-BR)**, with a simple toggle in the header.
*   **Data Export**:
    *   Export the complete analysis results for all processed URLs into `CSV`, `JSON`, or `DOCX` formats.
    *   The DOCX export is a well-formatted report, suitable for sharing and archiving.
*   **Scientific Article Generation**: With a single click, the application uses AI to synthesize the analysis data from all completed items into a formatted, publication-ready scientific manuscript, adhering to the standards of the *Journal of Coloproctology*.
*   **Browser Notifications**: If permission is granted, the application will send a native browser notification to alert the user when the entire analysis queue has been completed.

---

## How It Works: Technical Architecture

The application is a standalone Next.js project that intelligently combines a client-side user interface with powerful server-side actions and AI processing.

### 1. Frontend (`src/components/pages/discern-analyzer-page.tsx`)

*   **Framework**: Built with **Next.js** and **React** using the App Router. All components are React Server Components (`RSC`) by default, with client-side interactivity enabled via the `"use client";` directive.
*   **State Management**: Client-side state is managed using React hooks (`useState`, `useEffect`, `useMemo`, etc.). There is no external state management library. State is managed within the main page component, `DiscernAnalyzerPage`.
*   **UI Components**: The UI is built using **ShadCN/UI**, a collection of accessible and reusable components built on Radix UI and styled with **Tailwind CSS**.
*   **Internationalization**: A custom i18n system (`src/components/i18n`) uses a React Context Provider and a `useI18n` hook to deliver translations from JSON files (`src/components/i18n/translations.ts`).

### 2. Backend Logic (Next.js Server Actions)

*   **Entry Point**: All backend logic is triggered via **Next.js Server Actions** defined in `src/app/actions.ts`. These are functions marked with `"use server";` that can be called directly from client components.
*   **`processUrl(url, language)`**: This is the core action for a single URL analysis.
    1.  It uses `fetch` with a `User-Agent` header mimicking 'Googlebot/2.1' to retrieve the page's HTML.
    2.  It checks the `content-type` header to filter out PDFs.
    3.  It uses a regex-based function (`htmlToText`) to strip HTML tags and extract plain text. It also looks for video embeds.
    4.  If the text is too long, it calls the `summarizeLongContent` AI flow.
    5.  It then calls the `performDiscernAnalysis` AI flow with the final text content.
    6.  It returns the complete analysis result or an error status.
*   **`generateArticleAction({ items })`**: This action takes the successfully analyzed items, calls the `createScientificArticle` AI flow, and returns the generated manuscript content.

### 3. AI Integration (Google Genkit)

*   **Framework**: AI capabilities are powered by **Genkit**, an open-source framework for building AI-powered applications. The Genkit configuration is located in `src/ai/genkit.ts`.
*   **AI Flows (`src/ai/flows/`)**: Each distinct AI task is encapsulated in a "flow". A flow is a server-side function that orchestrates calls to AI models, defines input/output schemas using **Zod**, and can include other business logic.
    *   **`summarize-long-content.ts`**: Takes long text and a target language, and returns a concise summary.
    *   **`perform-discern-analysis.ts`**: The main analysis engine. It takes text content and a language, and uses a structured prompt with an output schema to force the model to return a JSON object containing the 16 scores, justifications, summary, and more.
    *   **`create-scientific-article.ts`**: Takes the collected analysis data, formats it into a detailed prompt, and instructs the AI model to generate a full scientific article based on a strict template inspired by the *Journal of Coloproctology*.

---

## Project Structure

Here is a breakdown of the most important files and directories in the project.

```
/
├── src/
│   ├── app/
│   │   ├── actions.ts        # Next.js Server Actions (backend logic).
│   │   ├── globals.css       # Global styles and Tailwind CSS theme variables.
│   │   ├── layout.tsx        # Root layout for the application.
│   │   └── page.tsx          # The main entry page of the app.
│   │
│   ├── ai/
│   │   ├── genkit.ts         # Genkit configuration and initialization.
│   │   └── flows/            # Directory for all Genkit AI flows.
│   │       ├── perform-discern-analysis.ts
│   │       ├── summarize-long-content.ts
│   │       └── create-scientific-article.ts
│   │
│   ├── components/
│   │   ├── app/              # Application-specific components.
│   │   │   ├── analysis-queue.tsx
│   │   │   └── result-card.tsx
│   │   ├── pages/
│   │   │   └── discern-analyzer-page.tsx # Main component orchestrating the UI.
│   │   ├── ui/               # Reusable UI components from ShadCN.
│   │   └── i18n/             # Internationalization components and translations.
│   │       ├── i18n-provider.tsx
│   │       ├── translations.ts
│   │       └── use-i18n.ts
│   │
│   ├── hooks/
│   │   └── use-toast.ts      # Hook for showing toast notifications.
│   │
│   └── lib/
│       ├── types.ts          # TypeScript type definitions for the app.
│       └── utils.ts          # Utility functions (CSV/JSON/DOCX export, etc.).
│
├── public/                 # Static assets (e.g., favicon).
├── package.json            # Project dependencies and scripts.
└── tailwind.config.ts      # Tailwind CSS configuration.
```

---

## Prerequisites and Setup

To run this application locally, you will need:

*   Node.js (v18 or later)
*   npm or another package manager
*   A Google AI API Key (for Gemini models)

### Setup Instructions

1.  **Install Dependencies**:
    Open a terminal in the project root and run:
    ```bash
    npm install
    ```

2.  **Configure Environment Variables**:
    Create a `.env` file in the project root and add your Google AI API key:
    ```
    GEMINI_API_KEY=your_google_ai_api_key_here
    ```

3.  **Run the Development Server**:
    Start the Next.js development server:
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:9002`.

---

## What the Application Does Not Do (Limitations & Future Scope)

*   **No User Accounts or Persistent Storage**: The application state is ephemeral and exists only in the browser for the current session. There is no database to save analyses between sessions.
*   **No True Background Processing**: The analysis is performed in the browser using server actions. If the user closes the browser tab, the analysis queue will stop. The browser notification feature helps mitigate this by allowing the user to switch tabs.
*   **Limited Error Handling for AI**: While the app handles network and scraping errors, it has basic error handling for failures during the AI analysis itself. If a Genkit flow fails, it will be marked as an "Analysis Error".
*   **No Dynamic `robots.txt` Parsing**: The tool impersonates Google Bot to bypass `robots.txt` but does not actually parse or respect its rules. This is a deliberate design choice to maximize content accessibility for analysis.
*   **No Login/Authentication**: This is a public-facing tool with no concept of user accounts or private data.
