// Test script to check available Keap API resources
export async function testKeapResources(serviceAccountKey: string) {
  const baseUrl = 'https://api.infusionsoft.com/crm/rest/v2';
  const headers = {
    'X-Keap-API-Key': serviceAccountKey,
    'Content-Type': 'application/json',
  };

  // List of all known Keap API v2 resources
  const resources = [
    'affiliates',
    'appointments', 
    'campaigns',
    'companies',
    'contacts',
    'emails',
    'files',
    'hooks',
    'locales',
    'merchants',
    'notes',
    'opportunities',
    'orders',
    'products',
    'settings',
    'subscriptions',
    'tags',
    'tasks',
    'transactions',
    'users',
  ];

  const results: Record<string, any> = {};

  for (const resource of resources) {
    try {
      const response = await fetch(`${baseUrl}/${resource}?limit=1`, {
        method: 'GET',
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        results[resource] = {
          status: 'accessible',
          statusCode: response.status,
          hasData: Array.isArray(data[resource]) ? data[resource].length > 0 : false,
          sampleCount: Array.isArray(data[resource]) ? data[resource].length : 0,
        };
      } else {
        results[resource] = {
          status: 'error',
          statusCode: response.status,
          message: response.statusText,
        };
      }
    } catch (error) {
      results[resource] = {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return results;
}