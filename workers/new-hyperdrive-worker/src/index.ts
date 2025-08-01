import { Client } from 'pg';
import { testKeapResources } from './keap-resources-test';

export interface Env {
  HYPERDRIVE: Hyperdrive;
  KEAP_SERVICE_ACCOUNT_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Create PostgreSQL client using Hyperdrive connection string
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
    });

    try {
      await client.connect();

      switch (path) {
        case '/':
          return new Response('Hyperdrive Worker is running!', {
            headers: { 'Content-Type': 'text/plain' },
          });

        case '/test':
          // Test database connection
          const result = await client.query('SELECT NOW() as time, version() as version');
          return new Response(JSON.stringify({
            status: 'connected',
            time: result.rows[0].time,
            version: result.rows[0].version,
          }), {
            headers: { 'Content-Type': 'application/json' },
          });

        case '/tables':
          // List all tables
          const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
          `);
          return new Response(JSON.stringify({
            tables: tables.rows.map(row => row.table_name),
          }), {
            headers: { 'Content-Type': 'application/json' },
          });

        case '/query':
          // Execute custom query from POST body
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
          }
          
          const { query, params } = await request.json() as { query: string; params?: any[] };
          if (!query) {
            return new Response('Query is required', { status: 400 });
          }

          const queryResult = params && params.length > 0 
            ? await client.query(query, params)
            : await client.query(query);
            
          return new Response(JSON.stringify({
            rows: queryResult.rows,
            rowCount: queryResult.rowCount,
          }), {
            headers: { 'Content-Type': 'application/json' },
          });

        case '/create-tables':
          // Create missing tables in Hyperdrive
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
          }

          const tableQueries = [
            `CREATE TABLE IF NOT EXISTS companies (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name TEXT NOT NULL,
              keap_app_id TEXT,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )`,
            `CREATE TABLE IF NOT EXISTS products (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              company_id UUID REFERENCES companies(id),
              keap_product_id TEXT UNIQUE,
              name TEXT NOT NULL,
              description TEXT,
              price DECIMAL(10,2),
              category TEXT,
              sku TEXT,
              active BOOLEAN DEFAULT true,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )`,
            `CREATE TABLE IF NOT EXISTS sync_logs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              company_id UUID REFERENCES companies(id),
              sync_type TEXT NOT NULL,
              status TEXT NOT NULL,
              records_processed INTEGER DEFAULT 0,
              errors JSONB DEFAULT '[]',
              started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              completed_at TIMESTAMP WITH TIME ZONE
            )`
          ];

          const results = [];
          for (const tableQuery of tableQueries) {
            try {
              await client.query(tableQuery);
              results.push({ success: true, query: tableQuery.split('(')[0] });
            } catch (error) {
              results.push({ success: false, query: tableQuery.split('(')[0], error: error.message });
            }
          }

          return new Response(JSON.stringify({ results }), {
            headers: { 'Content-Type': 'application/json' },
          });

        case '/keap-resources':
          // Test available Keap API resources
          if (!env.KEAP_SERVICE_ACCOUNT_KEY) {
            return new Response('KEAP_SERVICE_ACCOUNT_KEY not configured', { status: 500 });
          }
          
          const resources = await testKeapResources(env.KEAP_SERVICE_ACCOUNT_KEY);
          return new Response(JSON.stringify(resources, null, 2), {
            headers: { 'Content-Type': 'application/json' },
          });

        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.end();
    }
  },
};