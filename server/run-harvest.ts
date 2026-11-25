import { runHarvest } from './harvester.ts';

async function main() {
  console.log('=== AETHER-9 // MOISSONNAGE TELEMETRIQUE LLM ===');
  const { record } = await runHarvest('cli');
  console.log(`Terminé en ${record.durationMs}ms | Champs mis à jour : ${record.totalUpdatedFields}`);
  for (const src of record.sources) {
    console.log(`- [${src.status.toUpperCase()}] ${src.source}: ${src.message}`);
  }
  if (record.changes.length > 0) {
    console.log('\nModifications détectées :');
    for (const c of record.changes) {
      console.log(`  * ${c.modelName} (${c.field}): ${c.oldValue} -> ${c.newValue} [${c.source}]`);
    }
  }
}

main().catch((err) => {
  console.error('Erreur pendant le moissonnage:', err);
  process.exit(1);
});
