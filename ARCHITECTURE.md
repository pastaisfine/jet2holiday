# jet2holiday — Project Architecture

## Project Overview

**jet2holiday** is a collaborative travel planning web app built with React + Vite. Inspired by swipe-style interfaces (think dating apps), it lets groups plan trips together by swiping on places and activities — but crucially, it also captures the *reasoning* behind each preference, enabling genuine group consensus instead of majority-rules domination.

**Key differentiator:** Instead of just aggregating a group's "yes/no" votes, jet2holiday surfaces the *why* behind every swipe, making negotiation and itinerary compromise transparent and fair.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 |
| Routing | React Router DOM v7 |
| Animation | Framer Motion 13 |
| Drag & Drop | @dnd-kit/react |
| Maps | Mapbox GL / react-map-gl |
| Icons | Phosphor React |
| Utilities | clsx |
| Auth & BaaS | Supabase JS v2 |
| Backend (Edge) | Supabase Edge Functions (Deno/TypeScript) |
| AI | Google Gemini 2.0 Flash (via Edge Function) |
| Places Search | SerpApi (Google Maps Autocomplete engine) |
| Static Maps | Google Maps Static API |
| Linting | oxlint |

---

## Architecture Diagram

```mermaid
graph TD
    subgraph Browser["Browser (React SPA)"]
        direction TB

        main["main.jsx\n(Entry Point)"]
        App["App.jsx / Shell\n(Router + Layout)"]
        
        subgraph State["State Layer"]
            AppState["useAppState.js\n(localStorage-backed\nglobal state hook)"]
            AuthCtx["AuthContext.jsx\n(Supabase Auth\nsession + profile)"]
        end

        subgraph Pages["Pages (src/pages/)"]
            direction LR
            Splash["SplashScreen\n(Landing)"]
            Auth["LoginScreen\nRegisterScreen\nForgotPasswordScreen\nResetPasswordScreen"]
            Setup["SetupScreen\n(Trip config:\ndest, dates, leader)"]
            Swipe["SwipeScreen\n(Core swipe UX)"]
            Done["DoneScreen\n(Swipe summary)"]
            Style["StyleScreen\n(Travel style quiz)"]
            Hub["HubScreen\n(Trip dashboard)"]
            Plan["PlanScreen\n(Itinerary editor)"]
            Group["GroupScreen\n(Group members)"]
            Tasks["TasksScreen\n(Task board)"]
            Travel["TravelScreen\n(In-trip view +\nMapbox map)"]
            Profile["ProfileScreen\n(User settings)"]
        end

        subgraph Components["Shared Components (src/components/)"]
            AppHeader
            TabBar
            SwipeCard
            InfiniteSpiral["InfiniteSpiral\n(Animated history)"]
            LineSidebar["LineSidebar\n(Plan timeline)"]
            PreferenceForm
            ReasonChips
            StyleCard
            BottomSheet
            ProgressBar
        end

        subgraph Services["Services (src/services/)"]
            PlacesSvc["placesAutocomplete.js\n(Proxy call)"]
            MapboxSvc["mapbox.js\n(Directions API)"]
            TaskAgentSvc["taskAgent.js\n(AI task parser)"]
        end

        subgraph Lib["Lib (src/lib/)"]
            SupabaseClient["supabase.js\n(Supabase client)"]
        end

        subgraph Data["Static Data (src/data/)"]
            CardsData["cards.js\n(Place swipe cards)"]
            PlansData["plans.js\n(3 preset itineraries:\nbalanced, foodfirst, slower)"]
            StylesData["styles.js\n(Travel style profiles)"]
            MembersData["members.js\n(Mock group members)"]
            TravelData["travel.js\n(Flights, hotels, car rentals)"]
        end

        subgraph Utils["Utils (src/utils/)"]
            DateUtil["date.js\n(Date formatting)"]
        end
    end

    subgraph Supabase["Supabase Platform"]
        SupabaseAuth["Supabase Auth\n(Email/password)"]
        
        subgraph EdgeFunctions["Edge Functions (Deno)"]
            PlacesFn["places-autocomplete\n(SerpApi proxy +\nGoogle Static Maps)"]
            TaskFn["task-agent\n(Gemini AI:\nNL → task list)"]
        end
    end

    subgraph ExternalAPIs["External APIs"]
        SerpApi["SerpApi\n(Google Maps Autocomplete)"]
        GoogleStaticMaps["Google Maps\nStatic API"]
        GeminiAPI["Google Gemini 2.0 Flash\n(generativelanguage API)"]
        MapboxAPI["Mapbox Directions API\n(Walking routes)"]
    end

    %% Entry
    main --> App
    App --> State
    App --> Pages

    %% State wiring
    AppState -- "persisted to" --> LocalStorage[(localStorage\ntripder-state-v1)]
    AuthCtx --> SupabaseClient
    SupabaseClient --> SupabaseAuth

    %% Pages use state
    Pages --> AppState
    Pages --> AuthCtx

    %% Pages use components
    Pages --> Components

    %% Pages use data
    SwipeScreen --> CardsData
    PlanScreen --> PlansData
    StyleScreen --> StylesData
    GroupScreen --> MembersData
    TravelScreen --> TravelData
    SetupScreen --> PlacesSvc

    %% Services
    PlacesSvc -- "POST /places-autocomplete" --> PlacesFn
    TaskAgentSvc -- "POST /task-agent" --> TaskFn
    Travel --> MapboxSvc
    PlanScreen --> MapboxSvc
    MapboxSvc --> MapboxAPI
    TasksScreen --> TaskAgentSvc

    %% Edge function → external
    PlacesFn --> SerpApi
    PlacesFn --> GoogleStaticMaps
    TaskFn --> GeminiAPI
```

---

## User Flow

```mermaid
flowchart LR
    A([Splash]) --> B([Login / Register])
    B --> C([Setup\nDest + Dates])
    C --> D([Swipe\nLike · Skip + Reason])
    D --> E([Done\nSummary])
    E --> F([Style Quiz\nTravel persona])
    F --> G([Hub\nDashboard])
    G --> H([Plan\nItinerary editor])
    G --> I([Group\nMembers])
    G --> J([Tasks\nAI task board])
    G --> K([Travel\nMap + Logistics])
    G --> L([Profile\nSettings])
```

---

## Directory Structure

```
WhereDo/
├── src/
│   ├── main.jsx                  # React entry point
│   ├── App.jsx                   # Shell: router, layout chrome, theme
│   ├── App.css / index.css       # Global styles + design tokens
│   │
│   ├── pages/                    # Screen-level route components (15 screens)
│   │   ├── SplashScreen.jsx      # Landing / onboarding
│   │   ├── LoginScreen.jsx
│   │   ├── RegisterScreen.jsx
│   │   ├── ForgotPasswordScreen.jsx
│   │   ├── ResetPasswordScreen.jsx
│   │   ├── SetupScreen.jsx       # Trip config (destination, dates, leader)
│   │   ├── SwipeScreen.jsx       # Core swipe + reason capture
│   │   ├── DoneScreen.jsx        # Post-swipe summary
│   │   ├── StyleScreen.jsx       # Travel style quiz
│   │   ├── HubScreen.jsx         # Trip dashboard / entry hub
│   │   ├── PlanScreen.jsx        # Itinerary editor (drag-drop, map)
│   │   ├── GroupScreen.jsx       # Group member management
│   │   ├── TasksScreen.jsx       # AI-powered task board
│   │   ├── TravelScreen.jsx      # In-trip logistics + Mapbox map
│   │   └── ProfileScreen.jsx     # User profile & auth settings
│   │
│   ├── components/               # Reusable UI components (12 files)
│   │   ├── AppHeader.jsx         # Top nav bar
│   │   ├── TabBar.jsx            # Bottom tab navigation
│   │   ├── SwipeCard.jsx         # Individual swipeable card
│   │   ├── InfiniteSpiral.jsx    # Animated swipe history visualization
│   │   ├── LineSidebar.jsx       # Timeline sidebar for plan view
│   │   ├── PreferenceForm.jsx    # Swipe reason capture form
│   │   ├── ReasonChips.jsx       # Tag chips for swipe reasons
│   │   ├── StyleCard.jsx         # Travel style option card
│   │   ├── BottomSheet.jsx       # Slide-up modal sheet
│   │   └── ProgressBar.jsx       # Progress indicator
│   │
│   ├── state/
│   │   └── useAppState.js        # Central app state hook (localStorage-backed)
│   │
│   ├── context/
│   │   ├── AuthContext.jsx       # Auth provider (Supabase session mgmt)
│   │   ├── auth-state.js         # React context object
│   │   └── useAuth.js            # useAuth consumer hook
│   │
│   ├── services/
│   │   ├── placesAutocomplete.js # Calls places-autocomplete edge function
│   │   ├── mapbox.js             # Calls Mapbox Directions API
│   │   └── taskAgent.js          # Calls task-agent edge function (Gemini AI)
│   │
│   ├── lib/
│   │   └── supabase.js           # Supabase client initialization
│   │
│   ├── data/                     # Static mock/seed data
│   │   ├── cards.js              # Swipe card content for Lisbon
│   │   ├── plans.js              # 3 preset itineraries + route legs
│   │   ├── styles.js             # Travel style personas
│   │   ├── members.js            # Mock group member profiles
│   │   └── travel.js             # Mock flights, hotels, car rentals
│   │
│   └── utils/
│       └── date.js               # Date range formatting
│
├── supabase/
│   └── functions/
│       ├── places-autocomplete/  # Deno edge fn: SerpApi proxy
│       │   └── index.ts
│       └── task-agent/           # Deno edge fn: Gemini AI task parser
│           └── index.ts
│
├── public/                       # Static assets (images)
├── index.html                    # Vite entry HTML
├── vite.config.js
└── package.json
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **localStorage for app state** | `useAppState.js` persists the entire trip state (swipes, itinerary, tasks) to `localStorage` under `tripder-state-v1`. Simple, no backend DB needed for the core MVP flow. |
| **Supabase Auth only** | Supabase is used purely for authentication (email/password). No database tables — user data lives in Supabase Auth user metadata. |
| **Edge Functions as API proxies** | API secrets (SerpApi, Google Maps, Gemini) never reach the browser. All sensitive calls route through Supabase Deno edge functions. |
| **AI task extraction via Gemini** | The `task-agent` edge function sends natural-language trip messages to Gemini 2.0 Flash and gets back a structured JSON task list — enabling conversational task creation on the Tasks screen. |
| **Static itinerary data** | The three preset itineraries (`balanced`, `foodfirst`, `slower`) and swipe cards are hardcoded for the Lisbon MVP. User can layer drafts and custom "suggested" itineraries on top via `itineraryDrafts` / `userSuggestedItineraries` in state. |
| **No global state library** | All state is managed via a single custom hook (`useAppState`) passed as a prop — no Redux, Zustand, or similar, keeping the MVP lean. |
