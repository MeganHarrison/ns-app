// Test Keap API credentials
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    try {
      // Test different authentication methods
      const results = {
        timestamp: new Date().toISOString(),
        credentials: {
          hasServiceAccountKey: !!env.KEAP_SERVICE_ACCOUNT_KEY,
          hasClientId: !!env.KEAP_CLIENT_ID,
          hasClientSecret: !!env.KEAP_SECRET,
          hasAppId: !!env.KEAP_APP_ID
        },
        tests: []
      };

      // Test 1: Service Account Key (Direct API call)
      if (env.KEAP_SERVICE_ACCOUNT_KEY) {
        try {
          const sakResponse = await fetch('https://api.infusionsoft.com/crm/rest/v1/account/profile', {
            headers: {
              'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
              'Accept': 'application/json'
            }
          });

          results.tests.push({
            method: 'Service Account Key',
            endpoint: 'account/profile',
            status: sakResponse.status,
            statusText: sakResponse.statusText,
            success: sakResponse.ok,
            data: sakResponse.ok ? await sakResponse.json() : await sakResponse.text()
          });
        } catch (error) {
          results.tests.push({
            method: 'Service Account Key',
            error: error.message
          });
        }
      }

      // Test 2: Try to get orders with Service Account Key
      if (env.KEAP_SERVICE_ACCOUNT_KEY) {
        try {
          const ordersResponse = await fetch('https://api.infusionsoft.com/crm/rest/v1/orders?limit=5', {
            headers: {
              'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
              'Accept': 'application/json'
            }
          });

          const ordersData = ordersResponse.ok ? await ordersResponse.json() : null;
          
          results.tests.push({
            method: 'Service Account Key - Orders',
            endpoint: 'orders',
            status: ordersResponse.status,
            statusText: ordersResponse.statusText,
            success: ordersResponse.ok,
            orderCount: ordersData?.orders?.length || 0,
            data: ordersResponse.ok ? ordersData : await ordersResponse.text()
          });
        } catch (error) {
          results.tests.push({
            method: 'Service Account Key - Orders',
            error: error.message
          });
        }
      }

      // Test 3: OAuth Client Credentials Flow
      if (env.KEAP_CLIENT_ID && env.KEAP_SECRET) {
        try {
          const tokenResponse = await fetch('https://api.infusionsoft.com/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              grant_type: 'client_credentials',
              client_id: env.KEAP_CLIENT_ID,
              client_secret: env.KEAP_SECRET,
              scope: 'full'
            })
          });

          const tokenData = tokenResponse.ok ? await tokenResponse.json() : await tokenResponse.text();
          
          results.tests.push({
            method: 'OAuth Client Credentials',
            endpoint: 'token',
            status: tokenResponse.status,
            statusText: tokenResponse.statusText,
            success: tokenResponse.ok,
            data: tokenData
          });

          // If we got a token, try to use it
          if (tokenResponse.ok && tokenData.access_token) {
            const testResponse = await fetch('https://api.infusionsoft.com/crm/rest/v1/account/profile', {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/json'
              }
            });

            results.tests.push({
              method: 'OAuth Token Test',
              endpoint: 'account/profile',
              status: testResponse.status,
              statusText: testResponse.statusText,
              success: testResponse.ok,
              data: testResponse.ok ? await testResponse.json() : await testResponse.text()
            });
          }
        } catch (error) {
          results.tests.push({
            method: 'OAuth Client Credentials',
            error: error.message
          });
        }
      }

      // Test 4: Check API endpoints
      const endpoints = [
        'https://api.infusionsoft.com/crm/rest/v1/',
        'https://api.infusionsoft.com/crm/rest/v2/',
        'https://api.infusionsoft.com/crm/xmlrpc/v1/'
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${env.KEAP_SERVICE_ACCOUNT_KEY}`,
              'Accept': 'application/json'
            }
          });

          results.tests.push({
            method: 'Endpoint Test',
            endpoint: endpoint,
            status: response.status,
            reachable: response.status !== 0
          });
        } catch (error) {
          results.tests.push({
            method: 'Endpoint Test',
            endpoint: endpoint,
            error: error.message
          });
        }
      }

      return new Response(JSON.stringify(results, null, 2), {
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders 
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Test failed',
        message: error.message,
        stack: error.stack
      }, null, 2), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders 
        }
      });
    }
  }
};