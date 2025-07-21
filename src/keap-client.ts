export interface KeapConfig {
  serviceAccountKey: string;
}

export interface KeapOrder {
  id: string;
  title: string;
  status: string;
  total: {
    amount: number;
    currency_code: string;
    formatted_amount: string;
  };
  order_time: string;
  creation_time: string;
  contact: {
    id: string;
    email: string;
    given_name: string;
    family_name: string;
  };
  order_items: Array<{
    id: string;
    name: string;
    quantity: number;
    price: {
      amount: number;
      currency_code: string;
      formatted_amount: string;
    };
    product: {
      id: string;
      name: string;
      description: string;
    };
  }>;
}

export class KeapClient {
  private serviceAccountKey: string;
  private baseUrl = 'https://api.infusionsoft.com/crm/rest/v2';

  constructor(config: KeapConfig) {
    this.serviceAccountKey = config.serviceAccountKey;
  }

  private async makeRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'X-Keap-API-Key': this.serviceAccountKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Keap API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getOrders(limit: number = 100, offset: number = 0): Promise<{ orders: KeapOrder[]; count: number }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      order: 'creation_time',
      order_direction: 'descending'
    });

    const response = await this.makeRequest<{ orders: KeapOrder[]; count?: number }>(
      `/orders?${params.toString()}`
    );

    // Handle the actual API response format
    let orders: KeapOrder[] = [];
    
    if (Array.isArray(response)) {
      orders = response;
    } else {
      orders = response.orders || [];
    }

    // Sort by most recent first (fallback sorting in case API doesn't support it)
    orders.sort((a, b) => {
      const dateA = new Date(a.order_time || a.creation_time || 0);
      const dateB = new Date(b.order_time || b.creation_time || 0);
      return dateB.getTime() - dateA.getTime();
    });
    
    return {
      orders,
      count: response.count || orders.length
    };
  }

  async getAllOrders(): Promise<KeapOrder[]> {
    const allOrders: KeapOrder[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const { orders, count } = await this.getOrders(limit, offset);
      allOrders.push(...orders);

      if (allOrders.length >= count) {
        break;
      }

      offset += limit;
    }

    // Ensure final sort by most recent first
    allOrders.sort((a, b) => {
      const dateA = new Date(a.order_time || a.creation_time || 0);
      const dateB = new Date(b.order_time || b.creation_time || 0);
      return dateB.getTime() - dateA.getTime();
    });

    return allOrders;
  }
}