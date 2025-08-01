// pages/api/dashboard-data.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const days = req.query.days || '30';
    const response = await fetch(
      `${process.env.WORKER_URL}/dashboard-data?days=${days}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Worker responded with ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data' });
  }
}

// pages/api/orders.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { page = '1', limit = '20', status } = req.query;
    
    let url = `${process.env.WORKER_URL}/orders?page=${page}&limit=${limit}`;
    if (status) {
      url += `&status=${status}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Worker responded with ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Orders fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
}

// pages/api/sync-orders.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const fullSync = req.query.full_sync === 'true';
    
    const response = await fetch(
      `${process.env.WORKER_URL}/sync-orders?full_sync=${fullSync}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Worker responded with ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ message: 'Failed to sync orders' });
  }
}