# DISCERN Insights

DISCERN Insights is an AI-powered web application designed to automate the quality analysis of online health information using the validated DISCERN methodology. The tool enables researchers, medical professionals, and content creators to efficiently process large volumes of web pages, evaluate them against the 16 DISCERN criteria, and generate detailed reports, including a publication-ready scientific article.

The application is built with a modern web stack, leveraging Next.js for the frontend and server-side logic, and Google's Genkit for its powerful AI capabilities.

## Core Features

*   **URL Import**: Import URLs for analysis by pasting a list directly into a textarea or by uploading a `.csv` file. The application preserves all imported URLs, including duplicates, to support systematic review processes.
*   **Content Eligibility & Robust Scraping**:
    *   **Jina AI Integration**: Uses `r.jina.ai` to extract clean Markdown content from modern websites, including JS-heavy Single Page Applications.
    *   **Fallback Logic**: Automatically falls back to a native `fetch` (mimicking Google Bot) if the primary scraper fails.
    *   Identifies and filters out non-eligible content (social media posts, video platforms, PDFs) and rejects blocked or error pages. See [URL Eligibility Rules](#url-eligibility-rules).
*   **AI-Powered Summarization**: For articles with text content exceeding 30,000 characters, the tool uses an AI flow to summarize the content, ensuring the core information is retained for analysis.
*   **DISCERN Analysis**:
    *   An AI flow evaluates the extracted text against the 16 items of the DISCERN instrument.
    *   Generates a score (1-5) and a detailed justification for each of the 16 items.
    *   Produces an executive summary, key observations, and actionable recommendations for improvement.
*   **Stats Dashboard**:
    *   **Personal Analytics**: KPIs like average quality score, total analyses, and daily trends.
    *   **Admin Dashboard**: Global view of all system data, including domains ranking and cumulative statistics.
*   **User Authentication & Persistence**:
    *   Secure login and signup powered by **Supabase Auth**.
    *   Persistent storage for all analysis results in a **Supabase PostgreSQL** database.
    *   Role-based access (Regular User vs. Admin).
*   **Processing Control**:
    *   **Automatic Mode**: Process the entire queue of URLs sequentially without user intervention.
    *   **Manual Mode**: Process one URL at a time, allowing the user to trigger the next analysis.
    *   The ability to start, pause, and continue the analysis queue.
*   **Internationalization (i18n)**: The entire user interface and AI analysis output are available in both **English (en)** and **Brazilian Portuguese (pt-BR)**.
*   **Data Export**: Export results to `CSV`, `JSON`, or `DOCX` (well-formatted scientific report).
*   **Scientific Article Generation**: AI synthesis of all completed items into a publication-ready manuscript.

---

## 🗺️ Navegação e Rotas

A aplicação utiliza rotas protegidas e baseadas em cargos:

-   **`/` (Raiz)**: Detecta o estado de autenticação e redireciona automaticamente para o Dashboard ou Login.
-   **`/login` e `/signup`**: Portais de acesso e criação de conta.
-   **`/dashboard`**: A central da plataforma, organizada em abas:
    -   **🔬 Analisador**: A ferramenta principal de análise de URLs.
    -   **📊 Estatísticas**: 
        -   **Visão Usuário**: Gráficos e KPIs das suas próprias análises.
        -   **Visão Admin (Painel Administrativo)**: Ativada automaticamente para usuários com a role `admin`, permitindo a visualização de métricas globais de todo o sistema.

---

## 🧪 Methodology & Technical Architecture

The application implements a systematic, AI-driven pipeline designed for the rigorous and reproducible evaluation of online health information.

### 1. Data Collection & Screening
The system supports both individual and batch URL ingestion (via CSV/Text). Before evaluation, an automated screening process identifies and excludes formats outside the scope of the DISCERN instrument—social media posts, video platforms and standalone PDFs—ensuring the uniformity and integrity of the study sample.

#### URL Eligibility Rules

The rules live in `src/lib/eligibility.ts` (URL screening) and `src/lib/content.ts` (content checks). The same lists feed the eligibility footer on the dashboard, and every excluded URL carries its reason in the queue (hover the status badge) and in the CSV export.

| Status | What it covers | Why it is excluded |
|---|---|---|
| `completed` (accepted) | Web pages with written text: articles, health portals, hospitals, medical societies, government agencies, blogs. Also LinkedIn Pulse articles (`linkedin.com/pulse/...`), the one social-network exception: they are long-form written publications, the format DISCERN assesses | — |
| `not_eligible_social` | **Every URL** on Facebook, Instagram, TikTok, X/Twitter, Threads, LinkedIn (except Pulse articles), Pinterest, Reddit, Kwai, Telegram and WhatsApp, whatever the post type (text, image, carousel, video). LinkedIn short links (`lnkd.in`) stay excluded because they hide the destination | DISCERN was validated for written publications about treatment choices. Posts are short, ephemeral, depend on surrounding context (media, comments, author profile) and often sit behind a login wall. |
| `not_eligible_video` | YouTube, Vimeo, Dailymotion, Twitch, Rumble; also pages whose main content is an embedded video with little text | DISCERN assesses written text; the content is the video itself (no transcription is performed). |
| `not_eligible_pdf` | URLs pointing directly to a PDF file | The study assesses web pages. |
| `scraping_error` | Sites that refuse automated access (HTTP 401/403/429, bot-protection or "access denied" pages, `Target URL returned error 403` from the scraper), or fewer than 500 characters of extracted text | There is no assessable content. These can still be assessed with **Analyze Manually** by pasting the text. |
| `unavailable_offline` | The page returned any other HTTP error (404, 500, …) | The page is not reachable. |

Excluded and failed URLs are kept in the queue (systematic reviews must report them) but never enter averages, consensus or reliability statistics. To change the rules, edit the platform lists in `src/lib/eligibility.ts`; the footer updates automatically.

### 2. Content Extraction & Purification
To ensure high-precision assessment by the AI model, the platform employs a specialized engine that isolates the primary text from web pages. This process removes irrelevant "noise"—including advertisements, navigation menus, and pop-ups—that could otherwise introduce bias or distract the AI. Robust architectural layers ensure that content is correctly retrieved even from modern, complex websites with technical bot protections.

### 3. Contextual Refinement for Lengthy Content
For long-form health articles (exceeding 30,000 characters), the system performs an initial **Intelligent Synthesis**. This stage condenses the material while strictly preserving all essential clinical information and nuances. This optimization allows the AI to evaluate the material without losing the depth required for accurate scoring against the DISCERN protocol.

### 2. Analysis Engine (DISCERN Protocol)
The core logic is an AI "Evaluator Agent" powered by **Google Gemini 2.5 Flash**, orchestrated by **Google Genkit**.
*   **Systematic Evaluation**: Strictly applies the 16 validated criteria from the **DISCERN instrument** (University of Oxford). Every model receives the official question wording, the instrument's rating hints and its scale (1 = No, 2-4 = Partially, 5 = Yes; item 16 from Low to High quality), plus its skip rule (when item 1 is "No", item 2 is rated 1). The items live in a single source, `src/lib/discern-items.ts`, which the prompt, the schema, the interface, the exports and the article all read.
*   **Evidence-Based Justification**: For every score (1-5), the model generates a text-based justification citing observations from the source text.
*   **Domain Aggregation**: Results are categorized into *Reliability* (items 1-8), *Quality of Treatment Options* (items 9-15), and *Overall Quality* (item 16). The averages are computed by the code from the item scores, never by the model.
*   **Instrument Version**: Each result records `instrumentVersion` (currently `discern-official-v2`), and the analysis cache is keyed by it. The questions, hints and scale follow the DISCERN Handbook (1997). Question 4's hint also accepts external links, as in the online instrument, because the pages evaluated are websites. The Portuguese labels are the validated translation (Logullo et al., 2019). When question 1 is rated No, question 2 is left unrated and left out of the mean. A page rated 1 on question 4 cannot score 4 or 5 on question 5. Analyses without the current version used an earlier, non-official item set (item 10, "benefits", was missing and the question on treatment choices was repeated). They stay visible with a warning, but are excluded from statistics, reliability (ICC) and the article. Reprocess those URLs to include them.

### 3. Asynchronous Processing & Scalability
To support large-scale systematic reviews (e.g., automated analysis of 150+ URLs), the system employs a robust server-side architecture:
*   **Background Task Management**: Analysis orchestration is handled entirely on the server. This ensures that processing continues independently of the user's local connection, allowing the browser tab to be closed without interrupting the workflow.
*   **Sequential Batching & Automated Notifications**: The platform organizes the queue into continuous sequential batches. Once the entire study sample is processed, the system automatically triggers an email notification to the researcher, eliminating the need for constant manual monitoring.
*   **Secure Persistence & Live Progress Tracking**: All findings are stored in a secure, high-performance database. Users can track the status of their analysis through a dynamic progress bar that provides real-time updates as the AI completes each evaluation in the queue.

### 4. Technical Stack
*   **Frontend**: Next.js (App Router), ShadCN/UI, Tailwind CSS, Lucide.
*   **Backend**: Next.js Server Actions & API Routes, Supabase (Auth/Database/Realtime).
*   **AI Framework**: Google Genkit + Gemini 2.5 Flash.
*   **Cloud Infrastructure**: Vercel (Hobby/Pro), Upstash (Redis/QStash).

---

## Project Structure

Here is a breakdown of the most important files and directories in the project.

```
/
├── src/
│   ├── app/
│   │   ├── actions.ts        # Backend logic & Scraping.
│   │   ├── actions-analytics.ts # Stats & Admin calculations.
│   │   ├── dashboard/        # Main dashboard with tabs.
│   │   └── (auth)/           # Login/Signup flows.
│   ├── components/
│   │   ├── app/              # AnalysisQueue, ResultCard, StatsDashboard.
│   │   └── pages/            # DiscernAnalyzerPage.
│   └── lib/
│       ├── supabase-server.ts# Supabase client config.
│       └── types.ts          # Type definitions.
├── tests/                    # Playwright E2E tests.
└── package.json
```

---

## Prerequisites and Setup

To run this application locally, you will need:

*   Node.js (v18 or later)
*   A Google AI API Key (Gemini)
*   A Supabase Project (Auth & Database)

### Setup Instructions

1.  **Install Dependencies**: `npm install`
2.  **Environment Variables**: Create a `.env.local` file:
    ```
    GOOGLE_API_KEY=your_key
    NEXT_PUBLIC_SUPABASE_URL=your_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
    ```
3.  **Run Development**: `npm run dev` (Available at `http://localhost:9002`)
4.  **Run Tests**: `npm run test:e2e`

---

## What the Application Does Not Do (Limitations & Future Scope)

*   **AI Token Limits**: Very large sets of URLs might hit Google AI rate limits.
*   **Local Email Confirmation**: In development, Supabase requires manual email confirmation unless configured otherwise.
*   **Scraping Timeouts**: Some pages may block all crawlers, resulting in a timeout or failure (mitigated by fallback logic).
