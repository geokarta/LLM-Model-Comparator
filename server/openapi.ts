export function buildOpenApiSpec(serverUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'LLM Comparator & Cost Telemetry API',
      version: '2026.11.2',
      description:
        'API REST complète pour consulter les modèles LLM (2 dernières générations, 8 fournisseurs), leurs benchmarks (ARC-AGI 1/2/3, SWE-bench, GPQA, HLE, etc.), calculer les coûts par tokens en USD/CAD/devises live, et déclencher le moissonnage des tarifs.',
    },
    servers: [
      {
        url: serverUrl,
        description: 'Serveur courant',
      },
    ],
    tags: [
      { name: 'Catalogue', description: 'Modèles LLM et compagnies / fournisseurs' },
      { name: 'Calcul de Coût', description: 'Estimation de coûts par tokens en USD, CAD et devises live' },
      { name: 'Télémétrie & Moissonneur', description: 'Données complètes, synchronisation live et calibration' },
    ],
    paths: {
      '/api/health': {
        get: {
          tags: ['Télémétrie & Moissonneur'],
          summary: 'État du service',
          responses: {
            '200': {
              description: 'Service en ligne',
              content: {
                'application/json': {
                  example: {
                    status: 'online',
                    service: 'aether9-llm-telemetry',
                    timestamp: '2026-11-25T16:30:00.000Z',
                  },
                },
              },
            },
          },
        },
      },
      '/api/models': {
        get: {
          tags: ['Catalogue'],
          summary: 'Liste complète des modèles LLM',
          description: 'Retourne tous les modèles (34 modèles sur les 2 dernières générations) avec tarifs, contexte et benchmarks.',
          parameters: [
            {
              name: 'provider',
              in: 'query',
              required: false,
              description: 'Filtrer par compagnie (ex. openai, google, anthropic, deepseek, xai, meta, mistral, qwen)',
              schema: { type: 'string', example: 'openai' },
            },
            {
              name: 'generation',
              in: 'query',
              required: false,
              description: 'Filtrer par génération (`current` = Gén. N, `previous` = Gén. N-1)',
              schema: { type: 'string', enum: ['current', 'previous'] },
            },
          ],
          responses: {
            '200': { description: 'Liste des modèles' },
            '404': { description: 'Compagnie introuvable' },
          },
        },
      },
      '/api/providers': {
        get: {
          tags: ['Catalogue'],
          summary: 'Liste des compagnies / fournisseurs',
          description: 'Alias : `GET /api/companies`. Retourne les 8 fournisseurs avec nombre de modèles et générations couvertes.',
          responses: {
            '200': { description: 'Liste des compagnies' },
          },
        },
      },
      '/api/providers/{provider}/models': {
        get: {
          tags: ['Catalogue'],
          summary: 'Liste des modèles pour une compagnie donnée',
          description: 'Alias : `GET /api/companies/{provider}/models`.',
          parameters: [
            {
              name: 'provider',
              in: 'path',
              required: true,
              description: 'Identifiant ou nom de la compagnie (ex. openai, google, anthropic, deepseek, xai, meta, mistral, qwen)',
              schema: { type: 'string', example: 'openai' },
            },
            {
              name: 'generation',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['current', 'previous'] },
            },
          ],
          responses: {
            '200': { description: 'Modèles de la compagnie' },
            '404': { description: 'Compagnie introuvable' },
          },
        },
      },
      '/api/cost/token': {
        get: {
          tags: ['Calcul de Coût'],
          summary: 'Coût pour 1 modèle, un nombre de tokens et un sens (entrée ou sortie)',
          parameters: [
            {
              name: 'model',
              in: 'query',
              required: true,
              description: 'ID ou nom du modèle (ex. google-gemini-4-neon, openai-gpt-6-2-astra)',
              schema: { type: 'string', example: 'google-gemini-4-neon' },
            },
            {
              name: 'tokens',
              in: 'query',
              required: true,
              description: 'Nombre de tokens (>= 0)',
              schema: { type: 'number', example: 100000 },
            },
            {
              name: 'direction',
              in: 'query',
              required: true,
              description: 'Sens des tokens : `input` (ou `entree`) / `output` (ou `sortie`)',
              schema: { type: 'string', enum: ['input', 'output'], example: 'output' },
            },
            {
              name: 'currency',
              in: 'query',
              required: false,
              description: 'Devise souhaitée (défaut USD). Supporte USD, CAD, EUR, GBP, CHF...',
              schema: { type: 'string', default: 'USD', example: 'CAD' },
            },
          ],
          responses: {
            '200': { description: 'Coût calculé en USD, CAD et devise demandée' },
            '400': { description: 'Paramètre invalide ou manquant' },
            '404': { description: 'Modèle introuvable' },
          },
        },
        post: {
          tags: ['Calcul de Coût'],
          summary: 'Coût simple (POST JSON) pour 1 modèle et 1 sens',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['model', 'tokens', 'direction'],
                  properties: {
                    model: { type: 'string', example: 'google-gemini-4-neon' },
                    tokens: { type: 'number', example: 100000 },
                    direction: { type: 'string', enum: ['input', 'output'], example: 'output' },
                    currency: { type: 'string', example: 'CAD' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Coût calculé' },
          },
        },
      },
      '/api/cost/total': {
        get: {
          tags: ['Calcul de Coût'],
          summary: 'Coût total (entrée + sortie) en USD, CAD et devise au choix',
          parameters: [
            {
              name: 'model',
              in: 'query',
              required: true,
              schema: { type: 'string', example: 'openai-gpt-6-2-astra' },
            },
            {
              name: 'inputTokens',
              in: 'query',
              required: true,
              schema: { type: 'number', example: 50000 },
            },
            {
              name: 'outputTokens',
              in: 'query',
              required: true,
              schema: { type: 'number', example: 10000 },
            },
            {
              name: 'currency',
              in: 'query',
              required: false,
              description: 'Devise supplémentaire demandée (défaut CAD)',
              schema: { type: 'string', default: 'CAD', example: 'EUR' },
            },
          ],
          responses: {
            '200': { description: 'Coûts détaillés en USD, CAD et devise demandée' },
            '400': { description: 'Paramètre invalide' },
            '404': { description: 'Modèle introuvable' },
          },
        },
        post: {
          tags: ['Calcul de Coût'],
          summary: 'Coût total (POST JSON) entrée + sortie en USD, CAD et devise',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['model', 'inputTokens', 'outputTokens'],
                  properties: {
                    model: { type: 'string', example: 'openai-gpt-6-2-astra' },
                    inputTokens: { type: 'number', example: 50000 },
                    outputTokens: { type: 'number', example: 10000 },
                    currency: { type: 'string', example: 'CAD' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Coûts détaillés' },
          },
        },
      },
      '/api/cost/batch': {
        get: {
          tags: ['Calcul de Coût'],
          summary: 'Coût total (entrée + sortie) pour une liste de modèles',
          description: 'Alias : `/api/cost/compare`. Trie les résultats du moins cher au plus cher avec résumé global.',
          parameters: [
            {
              name: 'models',
              in: 'query',
              required: true,
              description: 'IDs ou noms séparés par virgules (ou `all` pour tous les modèles)',
              schema: {
                type: 'string',
                example: 'openai-gpt-6-2-astra,google-gemini-4-neon,deepseek-v4-pro',
              },
            },
            {
              name: 'inputTokens',
              in: 'query',
              required: true,
              schema: { type: 'number', example: 100000 },
            },
            {
              name: 'outputTokens',
              in: 'query',
              required: true,
              schema: { type: 'number', example: 20000 },
            },
            {
              name: 'currency',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'CAD', example: 'CAD' },
            },
          ],
          responses: {
            '200': { description: 'Comparatif de coûts multi-modèles' },
          },
        },
        post: {
          tags: ['Calcul de Coût'],
          summary: 'Coût total batch (POST JSON) pour un tableau de modèles',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['models', 'inputTokens', 'outputTokens'],
                  properties: {
                    models: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['openai-gpt-6-2-astra', 'google-gemini-4-neon', 'deepseek-v4-pro'],
                    },
                    inputTokens: { type: 'number', example: 100000 },
                    outputTokens: { type: 'number', example: 20000 },
                    currency: { type: 'string', example: 'CAD' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Comparatif de coûts multi-modèles' },
          },
        },
      },
      '/api/telemetry': {
        get: {
          tags: ['Télémétrie & Moissonneur'],
          summary: 'Dataset complet (fournisseurs, benchmarks, modèles, historique)',
          responses: {
            '200': { description: 'Objet TelemetryDataset complet' },
          },
        },
      },
      '/api/harvest': {
        post: {
          tags: ['Télémétrie & Moissonneur'],
          summary: 'Déclencher un moissonnage live (OpenRouter & ARC Prize)',
          responses: {
            '200': { description: 'Rapport de moissonnage et dataset mis à jour' },
          },
        },
      },
      '/api/models/{id}': {
        patch: {
          tags: ['Télémétrie & Moissonneur'],
          summary: 'Mettre à jour manuellement un modèle (tarifs ou scores)',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'google-gemini-4-neon' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    inputPricePer1M: { type: 'number', example: 1.25 },
                    outputPricePer1M: { type: 'number', example: 6.0 },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Modèle mis à jour' },
            '404': { description: 'Modèle introuvable' },
          },
        },
      },
    },
  };
}
