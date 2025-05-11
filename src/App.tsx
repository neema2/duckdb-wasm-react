import { useState, useEffect, KeyboardEvent } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Database, Info, Loader2 } from 'lucide-react';
import './App.css';

const DUCKDB_BUNDLES = {
  mvp: {
    mainModule: '/duckdb/duckdb-mvp.wasm',
    mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
  },
  eh: {
    mainModule: '/duckdb/duckdb-eh.wasm',
    mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
  },
};

const CSV_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/iris.csv';
const PARQUET_FILE_PATH = '/data/iris.parquet';
const ICEBERG_TABLE_URL = 'https://s3.amazonaws.com/hyperparam-iceberg/spark/bunnies'; // Public demo Iceberg table

function App() {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [query, setQuery] = useState<string>('SELECT * FROM iris LIMIT 10;');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Initializing DuckDB...');
  const [showExamples, setShowExamples] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<'csv' | 'parquet' | 'iceberg'>('csv');
  const [parquetLoaded, setParquetLoaded] = useState<boolean>(false);
  const [icebergLoaded, setIcebergLoaded] = useState<boolean>(false);
  const [icebergVersion, setIcebergVersion] = useState<string | null>(null);
  const [icebergVersions, setIcebergVersions] = useState<string[]>([]);

  const csvExampleQueries = [
    'SELECT * FROM iris LIMIT 10;',
    'SELECT Name, COUNT(*) as Count FROM iris GROUP BY Name;',
    'SELECT AVG(SepalLength) as AvgSepalLength, AVG(SepalWidth) as AvgSepalWidth, Name FROM iris GROUP BY Name;',
    'SELECT * FROM iris WHERE PetalLength > 5.0;',
    'SELECT * FROM iris ORDER BY SepalLength DESC LIMIT 5;'
  ];
  
  const parquetExampleQueries = [
    'SELECT * FROM iris_parquet LIMIT 10;',
    'SELECT Name, COUNT(*) as Count FROM iris_parquet GROUP BY Name;',
    'SELECT AVG(SepalLength) as AvgSepalLength, AVG(SepalWidth) as AvgSepalWidth, Name FROM iris_parquet GROUP BY Name;',
    'SELECT * FROM iris_parquet WHERE PetalLength > 5.0;',
    'SELECT * FROM iris_parquet ORDER BY SepalLength DESC LIMIT 5;'
  ];
  
  const icebergExampleQueries = [
    'SELECT * FROM iceberg_data LIMIT 10;',
    'SELECT count(*) FROM iceberg_data;',
    'SELECT * FROM iceberg_data ORDER BY id LIMIT 5;',
    'SELECT category, COUNT(*) as Count FROM iceberg_data GROUP BY category;',
    'SELECT AVG(value) as AvgValue FROM iceberg_data;'
  ];

  const loadParquetData = async () => {
    if (!conn || !db) {
      setError('Database connection not initialized');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      setStatus('Loading parquet data...');
      
      await conn.query(`INSTALL parquet; LOAD parquet;`);
      
      const fullUrl = window.location.origin + PARQUET_FILE_PATH;
      console.log('Loading parquet from URL:', fullUrl);
      
      await conn.query(`
        CREATE TABLE IF NOT EXISTS iris_parquet AS 
        SELECT * 
        FROM read_parquet('${fullUrl}')
      `);
      
      setParquetLoaded(true);
      setStatus('Parquet data loaded successfully. Ready to query!');
      
      setQuery('SELECT * FROM iris_parquet LIMIT 10;');
      setDataSource('parquet');
    } catch (err) {
      console.error('Failed to load parquet data', err);
      setError(`Failed to load parquet data: ${err instanceof Error ? err.message : String(err)}`);
      setStatus('Error loading parquet data');
      throw err; // Re-throw the error to ensure no fallback logic is used
    } finally {
      setLoading(false);
    }
  };

  const loadIcebergData = async (version?: string) => {
    if (!conn || !db) {
      setError('Database connection not initialized');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      setStatus('Loading Iceberg data...');
      
      await conn.query(`INSTALL parquet; LOAD parquet;`);
      
      const { icebergMetadata, icebergLatestVersion, icebergListVersions } = await import('icebird');
      
      const metadataFileName = version ? `${version}.metadata.json` : undefined;
      
      // Get all available versions of the Iceberg table
      const versions = await icebergListVersions({ tableUrl: ICEBERG_TABLE_URL });
      setIcebergVersions(versions);
      
      const metadata = await icebergMetadata({ 
        tableUrl: ICEBERG_TABLE_URL,
        metadataFileName
      });
      
      const currentVersion = version || (await icebergLatestVersion({ tableUrl: ICEBERG_TABLE_URL }));
      setIcebergVersion(currentVersion);
      
      const { icebergManifests } = await import('icebird');
      const manifestList = await icebergManifests(metadata);
      
      // Convert manifest entries to array and filter out deleted entries
      const manifestEntries = Array.from(manifestList.entries());
      const dataEntries = manifestEntries.flatMap(([_, manifest]) => 
        manifest.entries.filter((entry: any) => entry.status !== 2)
      );
      
      if (dataEntries.length === 0) {
        throw new Error('No data files found in Iceberg manifest');
      }
      
      await conn.query(`DROP TABLE IF EXISTS iceberg_data`);
      
      const schemaFields = metadata.schemas.find(s => s['schema-id'] === metadata['current-schema-id'])?.fields;
      if (!schemaFields) {
        throw new Error('Schema not found in Iceberg metadata');
      }
      
      for (let i = 0; i < Math.min(dataEntries.length, 3); i++) { // Limit to first 3 files for performance
        const dataFile = dataEntries[i].data_file;
        const fileUrl = dataFile.file_path;
        
        const tableName = i === 0 ? 'iceberg_data' : `temp_iceberg_${i}`;
        await conn.query(`
          CREATE TABLE ${tableName} AS 
          SELECT * 
          FROM read_parquet('${fileUrl}')
        `);
        
        if (i > 0) {
          await conn.query(`
            INSERT INTO iceberg_data
            SELECT * FROM ${tableName}
          `);
          
          await conn.query(`DROP TABLE ${tableName}`);
        }
      }
      
      setIcebergLoaded(true);
      setStatus(`Iceberg data loaded successfully (version ${currentVersion}). Ready to query!`);
      
      setQuery('SELECT * FROM iceberg_data LIMIT 10;');
      setDataSource('iceberg');
    } catch (err) {
      console.error('Failed to load Iceberg data', err);
      setError(`Failed to load Iceberg data: ${err instanceof Error ? err.message : String(err)}`);
      setStatus('Error loading Iceberg data');
      throw err; // Re-throw the error to ensure no fallback logic is used
    } finally {
      setLoading(false);
    }
  };
  
  const refreshIcebergData = async () => {
    if (!conn || !db) {
      setError('Database connection not initialized');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      setStatus('Checking for Iceberg table updates...');
      
      const { icebergLatestVersion } = await import('icebird');
      
      // Get the latest version of the Iceberg table
      const latestVersion = await icebergLatestVersion({ tableUrl: ICEBERG_TABLE_URL });
      
      if (latestVersion !== icebergVersion) {
        setStatus(`Found new version: ${latestVersion}. Loading...`);
        await loadIcebergData(latestVersion);
      } else {
        setStatus(`Already at latest version: ${latestVersion}`);
        setLoading(false);
      }
    } catch (err) {
      console.error('Failed to refresh Iceberg data', err);
      setError(`Failed to refresh Iceberg data: ${err instanceof Error ? err.message : String(err)}`);
      setStatus('Error refreshing Iceberg data');
      setLoading(false);
    }
  };

  useEffect(() => {
    const initDB = async () => {
      try {
        setStatus('Loading DuckDB WASM...');
        const workerUrl = new URL(DUCKDB_BUNDLES.eh.mainWorker, window.location.origin);
        const worker = new Worker(workerUrl);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(DUCKDB_BUNDLES.eh.mainModule);
        
        try {
          console.log('Using DuckDB bundle with parquet support');
        } catch (err) {
          console.warn('Could not initialize parquet support:', err);
        }
        
        setDb(db);
        
        const conn = await db.connect();
        setConn(conn);
        
        setStatus('Loading data from CSV...');
        await conn.query(`
          CREATE TABLE iris AS 
          SELECT * 
          FROM read_csv_auto('${CSV_URL}')
        `);
        
        setStatus('Data loaded successfully. Ready to query!');
      } catch (err) {
        console.error('Failed to initialize DuckDB', err);
        setError(`Failed to initialize DuckDB: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('Error initializing DuckDB');
      }
    };

    initDB();

    return () => {
      if (conn) {
        conn.close();
      }
      if (db) {
        db.terminate();
      }
    };
  }, []);

  const executeQuery = async () => {
    if (!conn || !query.trim()) return;
    
    setLoading(true);
    setError(null);
    setResults(null);
    
    try {
      const result = await conn.query(query);
      
      const columnNames = result.schema.fields.map(field => field.name);
      
      const rows = result.toArray();
      
      const formattedResults = rows.map(row => {
        const obj: Record<string, any> = {};
        for (let i = 0; i < columnNames.length; i++) {
          obj[columnNames[i]] = row[columnNames[i]] !== undefined ? row[columnNames[i]] : row[i];
        }
        return obj;
      });
      
      setResults(formattedResults);
    } catch (err) {
      console.error('Query failed', err);
      setError(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  };

  const setExampleQuery = (example: string) => {
    setQuery(example);
    setShowExamples(false);
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card className="mb-6 shadow-md">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Database className="h-7 w-7 text-blue-600" />
            DuckDB-WASM Query Interface
          </CardTitle>
          <CardDescription className="text-gray-600 mt-1">
            A minimal TypeScript/React app using embedded DuckDB-WASM to query real data from the Iris dataset.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <p className="text-sm text-gray-600 flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : conn ? 'bg-green-500' : 'bg-red-500'}`}></span>
                Status: {status}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowExamples(!showExamples)}
                className="text-xs"
              >
                {showExamples ? 'Hide Examples' : 'Show Examples'}
              </Button>
            </div>

            <div className="flex space-x-2 mb-4">
              <Button
                variant={dataSource === 'csv' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDataSource('csv')}
                className="text-xs"
              >
                CSV Data
              </Button>
              <Button
                variant={dataSource === 'parquet' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!parquetLoaded) {
                    loadParquetData();
                  } else {
                    setDataSource('parquet');
                    setQuery('SELECT * FROM iris_parquet LIMIT 10;');
                  }
                }}
                className="text-xs"
                disabled={loading || !conn}
              >
                {loading && dataSource === 'csv' && !parquetLoaded ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading Parquet...
                  </span>
                ) : 'Parquet Data'}
              </Button>
              <Button
                variant={dataSource === 'iceberg' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!icebergLoaded) {
                    loadIcebergData();
                  } else {
                    setDataSource('iceberg');
                    setQuery('SELECT * FROM iceberg_data LIMIT 10;');
                  }
                }}
                className="text-xs"
                disabled={loading || !conn}
              >
                {loading && dataSource !== 'iceberg' && !icebergLoaded ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading Iceberg...
                  </span>
                ) : 'Iceberg Data'}
              </Button>
            </div>
            
            {dataSource === 'iceberg' && icebergVersions.length > 0 && (
              <div className="flex flex-col space-y-2 mt-2 mb-4">
                <p className="text-xs text-gray-600">Iceberg Version:</p>
                <div className="flex flex-wrap gap-1">
                  {icebergVersions.map((version) => (
                    <Button
                      key={version}
                      variant={icebergVersion === version ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => loadIcebergData(version)}
                      className="text-xs"
                      disabled={loading}
                    >
                      {version}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshIcebergData}
                  className="text-xs flex items-center gap-1"
                  disabled={loading}
                >
                  <Loader2 className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                  Check for Updates
                </Button>
              </div>
            )}

            {showExamples && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                <p className="text-sm font-medium mb-2">Example Queries:</p>
                <div className="space-y-2">
                  {(dataSource === 'csv' 
                    ? csvExampleQueries 
                    : dataSource === 'parquet' 
                      ? parquetExampleQueries 
                      : icebergExampleQueries
                  ).map((example, index) => (
                    <div 
                      key={index} 
                      className="text-xs font-mono bg-white p-2 rounded cursor-pointer hover:bg-blue-50 border border-gray-200"
                      onClick={() => setExampleQuery(example)}
                    >
                      {example}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter SQL query... (Press Ctrl+Enter to execute)"
              className="font-mono h-40 mb-3 text-sm"
            />
            <Button 
              onClick={executeQuery} 
              disabled={loading || !conn}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Executing Query...
                </span>
              ) : 'Execute Query (Ctrl+Enter)'}
            </Button>
          </div>
          
          {error && (
            <div className="p-4 mb-4 bg-red-50 text-red-700 rounded-md border border-red-200">
              <p className="font-medium mb-1">Error:</p>
              <p className="text-sm font-mono">{error}</p>
            </div>
          )}
          
          {results && results.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium text-gray-700">Query Results</h3>
                <p className="text-xs text-gray-500">{results.length} rows returned</p>
              </div>
              <div className="overflow-x-auto rounded-md border border-gray-200 shadow-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-300">
                      {Object.keys(results[0]).map((key) => (
                        <th key={key} className="p-3 text-left text-gray-700 font-medium">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        {Object.values(row).map((value, j) => (
                          <td key={j} className="p-3 border-t border-gray-200">
                            {String(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {results && results.length === 0 && (
            <div className="p-4 text-center text-gray-500 bg-gray-50 rounded-md border border-gray-200">
              Query executed successfully, but no results were returned.
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-600">
                <p className="mb-1"><strong>About the Dataset:</strong> The Iris dataset contains measurements of 150 iris flowers from three different species.</p>
                <p className="mb-1">Use SQL queries to explore sepal length/width, petal length/width, and species name. Try filtering, grouping, and aggregating the data.</p>
                <p className="mt-2"><strong>Data Sources:</strong></p>
                <ul className="list-disc list-inside ml-2">
                  <li><strong>CSV:</strong> Loaded from a public URL using <code>read_csv_auto</code></li>
                  <li><strong>Parquet:</strong> Loaded from a local file using <code>read_parquet</code></li>
                  <li><strong>Iceberg:</strong> Parquet files extracted from Iceberg metadata using the <code>icebird</code> library</li>
                </ul>
                <p className="mt-2 text-xs text-gray-500">DuckDB-WASM supports multiple file formats including CSV, Parquet, and JSON.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
