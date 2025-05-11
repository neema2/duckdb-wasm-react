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
};

const CSV_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/iris.csv';

function App() {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [query, setQuery] = useState<string>('SELECT * FROM iris LIMIT 10;');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Initializing DuckDB...');
  const [showExamples, setShowExamples] = useState<boolean>(false);

  const exampleQueries = [
    'SELECT * FROM iris LIMIT 10;',
    'SELECT Name, COUNT(*) as Count FROM iris GROUP BY Name;',
    'SELECT AVG(SepalLength) as AvgSepalLength, AVG(SepalWidth) as AvgSepalWidth, Name FROM iris GROUP BY Name;',
    'SELECT * FROM iris WHERE PetalLength > 5.0;',
    'SELECT * FROM iris ORDER BY SepalLength DESC LIMIT 5;'
  ];

  useEffect(() => {
    const initDB = async () => {
      try {
        setStatus('Loading DuckDB WASM...');
        const worker = new Worker(DUCKDB_BUNDLES.mvp.mainWorker);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(DUCKDB_BUNDLES.mvp.mainModule);
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

            {showExamples && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                <p className="text-sm font-medium mb-2">Example Queries:</p>
                <div className="space-y-2">
                  {exampleQueries.map((example, index) => (
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
                <p>Use SQL queries to explore sepal length/width, petal length/width, and species name. Try filtering, grouping, and aggregating the data.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
