import { icebergMetadata, icebergListVersions, icebergLatestVersion, icebergManifests } from 'icebird';

const ICEBERG_TABLE_URL = 'https://s3.amazonaws.com/hyperparam-iceberg/spark/bunnies';

/**
 * Test Iceberg time travel functionality by:
 * 1. Fetching all available versions
 * 2. Getting metadata for each version
 * 3. Comparing schema and data files between versions
 */
async function testIcebergTimeTravel() {
  try {
    console.log('=== ICEBERG TIME TRAVEL TEST ===');
    console.log('Table URL:', ICEBERG_TABLE_URL);
    
    console.log('\nFetching available versions...');
    const versions = await icebergListVersions({ tableUrl: ICEBERG_TABLE_URL });
    console.log('Available versions:', versions);
    
    if (versions.length < 2) {
      console.warn('Warning: Need at least 2 versions to test time travel. Only found', versions.length);
      return;
    }
    
    const latestVersion = await icebergLatestVersion({ tableUrl: ICEBERG_TABLE_URL });
    console.log('Latest version:', latestVersion);
    
    const lastTwoVersions = versions.slice(-2);
    console.log('\nTesting time travel between versions:', lastTwoVersions);
    
    const versionMetadata = [];
    
    for (const version of lastTwoVersions) {
      console.log(`\n=== Version ${version} ===`);
      
      const metadata = await icebergMetadata({ 
        tableUrl: ICEBERG_TABLE_URL,
        metadataFileName: `${version}.metadata.json` 
      });
      
      versionMetadata.push({ version, metadata });
      
      const schema = metadata.schemas.find(s => s['schema-id'] === metadata['current-schema-id']);
      console.log('Schema ID:', metadata['current-schema-id']);
      console.log('Fields:', schema?.fields);
      
      const snapshot = metadata.snapshots.find(s => s.snapshot_id.toString() === version);
      console.log('Snapshot:', snapshot);
      
      const manifestList = await icebergManifests(metadata);
      const manifestEntries = Array.from(manifestList.entries());
      const dataFiles = manifestEntries.flatMap(([_, manifest]) => 
        manifest.entries.filter((entry) => entry.status !== 2)
      );
      
      console.log('Data files count:', dataFiles.length);
      if (dataFiles.length > 0) {
        console.log('Sample data file:', dataFiles[0].data_file);
      }
    }
    
    if (versionMetadata.length === 2) {
      const [olderVersion, newerVersion] = versionMetadata;
      console.log('\n=== Version Comparison ===');
      
      const olderSchema = olderVersion.metadata.schemas.find(
        s => s['schema-id'] === olderVersion.metadata['current-schema-id']
      );
      const newerSchema = newerVersion.metadata.schemas.find(
        s => s['schema-id'] === newerVersion.metadata['current-schema-id']
      );
      
      console.log('Schema changed:', 
        JSON.stringify(olderSchema) !== JSON.stringify(newerSchema));
      
      console.log('Older snapshot ID:', olderVersion.version);
      console.log('Newer snapshot ID:', newerVersion.version);
      
      const olderManifestList = await icebergManifests(olderVersion.metadata);
      const newerManifestList = await icebergManifests(newerVersion.metadata);
      
      const olderManifestEntries = Array.from(olderManifestList.entries());
      const newerManifestEntries = Array.from(newerManifestList.entries());
      
      const olderDataFiles = olderManifestEntries.flatMap(([_, manifest]) => 
        manifest.entries.filter((entry) => entry.status !== 2)
      );
      const newerDataFiles = newerManifestEntries.flatMap(([_, manifest]) => 
        manifest.entries.filter((entry) => entry.status !== 2)
      );
      
      console.log('Older version data files count:', olderDataFiles.length);
      console.log('Newer version data files count:', newerDataFiles.length);
      console.log('Data files changed:', olderDataFiles.length !== newerDataFiles.length);
    }
    
    console.log('\nTime travel test completed successfully!');
  } catch (error) {
    console.error('Error during time travel test:', error);
    throw error; // Re-throw to ensure no fallback logic is used
  }
}

testIcebergTimeTravel().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
