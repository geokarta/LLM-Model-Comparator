# LLM Model Comparator

Application web et API REST (Tabler.io dark + Plotly.js + Express/TypeScript) permettant de comparer les modèles LLM sur les **2 dernières générations (Gén. N & N-1)** de 8 fournisseurs (*OpenAI, Google DeepMind, Anthropic, DeepSeek, xAI, Meta AI, Mistral AI, Alibaba Qwen*) à travers 10 benchmarks du marché (**ARC-AGI 1/2/3**, **SWE-bench Verified**, **GPQA Diamond**, **Humanity's Last Exam**, **FrontierMath**, **Terminal-Bench**, **LiveBench**, **LMArena**).

## Fonctionnalités principales

- **Comparateur Multi-Fournisseurs & Intra-Fournisseur** : filtrage par génération (`N & N-1`, `N`, `N-1`), positionnement, Open-Weight, et épinglage jusqu'à 5 modèles.
- **Graphiques interactifs Plotly.js (Pan & Zoom libres + bascule Échelle Log / Normal)** :
  - Positionnement & Frontière de Pareto (Puissance vs Coût par tâche)
  - Radar Multi-Benchmarks (8 axes normalisés)
  - **Courbe de Prédiction AI 2027** (horizon temporel autonome METR, jalons *Agent-0 → Agent-4*, zones **Warning** et **Danger Critique**)
- **Simulateur de Coût par Tokens (`/simulator`)** : calcul en **USD**, **CAD** et devises live (`EUR`, `GBP`, `CHF`), projection mensuelle et comparatif multi-modèles.
- **Codex des Benchmarks** : explication détaillée, méthodologie, niveau de saturation et Top 5 de chaque benchmark.
- **Moissonneur Live (`npm run harvest`)** : synchronisation des prix et fenêtres de contexte via l'API OpenRouter avec journal des deltas et calibration manuelle.
- **API REST & Documentation Swagger UI (`/api/docs`)** :
  - `GET /api/models` — liste complète des modèles (`?provider=...&generation=current|previous`)
  - `GET /api/providers` (`/api/companies`) — liste des 8 fournisseurs
  - `GET /api/providers/:provider/models` — modèles d'un fournisseur
  - `GET/POST /api/cost/token` — coût pour 1 modèle, N tokens et sens (`input` / `output`)
  - `GET/POST /api/cost/total` — coût total entrée + sortie en USD, CAD et devise au choix
  - `GET/POST /api/cost/batch` — coût total pour une liste de modèles
  - `GET /api/openapi.json` & `GET /api/docs` — spécification OpenAPI 3.0.3 & Swagger UI

## Démarrage local

```bash
npm install
npm run dev
```

- Frontend : `http://localhost:5173`
- API & Swagger : `http://localhost:3001/api/docs`

## Moissonnage manuel des données

```bash
npm run harvest
```

## Déploiement Google Cloud Run

```powershell
gcloud run deploy aether9-llm-matrix --source . --project=aether9-llm-matrix-2026 --region=northamerica-northeast1 --allow-unauthenticated
```
