export interface KeapConfig {
  serviceAccountKey: string;
}

export interface KeapContact {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  phone_number?: string;
  tag_ids?: number[];
  custom_fields?: Record<string, any>;
  date_created: string;
  last_updated: string;
  lifecycle_stage?: string;
}

export interface KeapProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  sku?: string;
  active: boolean;
  product_category?: string;
}

export interface KeapSubscription {
  id: string;
  contact_id: string;
  product_id: string;
  status: string;
  billing_amount: number;
  billing_cycle: string;
  start_date: string;
  next_bill_date?: string;
  end_date?: string;
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
      const errorBody = await response.text();
      console.error('Keap API error details:', errorBody);
      throw new Error(`Keap API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    return response.json();
  }

  async getOrders(limit: number = 100, offset: number = 0, options?: { since?: string; until?: string }): Promise<{ orders: KeapOrder[]; count: number }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      order: 'order_date',  // Changed from creation_time to order_date
      order_direction: 'descending'  // Newest first
    });

    // Add date filters if provided
    if (options?.since) {
      params.append('since', options.since);
    }
    if (options?.until) {
      params.append('until', options.until);
    }

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

  async getOrder(orderId: string): Promise<KeapOrder | null> {
    try {
      const order = await this.makeRequest<KeapOrder>(`/orders/${orderId}`);
      return order;
    } catch (error) {
      console.error(`Failed to get order ${orderId}:`, error);
      return null;
    }
  }

  // Contacts methods
  async getContacts(limit: number = 100, offset: number = 0): Promise<{ contacts: KeapContact[]; count: number }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString()
    });

    const response = await this.makeRequest<{ contacts: KeapContact[]; count?: number }>(
      `/contacts?${params.toString()}`
    );

    let contacts: KeapContact[] = [];
    
    if (Array.isArray(response)) {
      contacts = response;
    } else {
      contacts = response.contacts || [];
    }

    return {
      contacts,
      count: response.count || contacts.length
    };
  }

  async getAllContacts(): Promise<KeapContact[]> {
    const allContacts: KeapContact[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const { contacts, count } = await this.getContacts(limit, offset);
      allContacts.push(...contacts);

      if (allContacts.length >= count) {
        break;
      }

      offset += limit;
    }

    return allContacts;
  }

  async getContact(contactId: string): Promise<KeapContact> {
    return this.makeRequest<KeapContact>(`/contacts/${contactId}`);
  }

  // Products methods
  async getProducts(limit: number = 100, offset: number = 0): Promise<{ products: KeapProduct[]; count: number }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString()
    });

    const response = await this.makeRequest<{ products: KeapProduct[]; count?: number }>(
      `/products?${params.toString()}`
    );

    let products: KeapProduct[] = [];
    
    if (Array.isArray(response)) {
      products = response;
    } else {
      products = response.products || [];
    }

    return {
      products,
      count: response.count || products.length
    };
  }

  async getAllProducts(): Promise<KeapProduct[]> {
    const allProducts: KeapProduct[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const { products, count } = await this.getProducts(limit, offset);
      allProducts.push(...products);

      if (allProducts.length >= count) {
        break;
      }

      offset += limit;
    }

    return allProducts;
  }

  // Subscriptions methods
  async getSubscriptions(limit: number = 100, offset: number = 0): Promise<{ subscriptions: KeapSubscription[]; count: number }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString()
    });

    const response = await this.makeRequest<{ subscriptions: KeapSubscription[]; count?: number }>(
      `/subscriptions?${params.toString()}`
    );

    let subscriptions: KeapSubscription[] = [];
    
    if (Array.isArray(response)) {
      subscriptions = response;
    } else {
      subscriptions = response.subscriptions || [];
    }

    return {
      subscriptions,
      count: response.count || subscriptions.length
    };
  }

  async getAllSubscriptions(): Promise<KeapSubscription[]> {
    const allSubscriptions: KeapSubscription[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const { subscriptions, count } = await this.getSubscriptions(limit, offset);
      allSubscriptions.push(...subscriptions);

      if (allSubscriptions.length >= count) {
        break;
      }

      offset += limit;
    }

    return allSubscriptions;
  }

  // Update subscription - specifically for modifying next_bill_date
  async updateSubscription(subscriptionId: string, updates: { next_bill_date?: string; pause_until?: string }): Promise<KeapSubscription> {
    try {
      // Try PUT first (more common for Keap), then fall back to PATCH if needed
      const response = await this.makeRequest<KeapSubscription>(
        `/subscriptions/${subscriptionId}`,
        {
          method: 'PUT',
          body: JSON.stringify(updates)
        }
      );
      return response;
    } catch (error) {
      console.error('PUT failed, trying PATCH:', error.message);
      // If PUT fails, try PATCH
      const response = await this.makeRequest<KeapSubscription>(
        `/subscriptions/${subscriptionId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates)
        }
      );
      return response;
    }
  }

  // Get a single subscription by ID
  async getSubscription(subscriptionId: string): Promise<KeapSubscription> {
    const response = await this.makeRequest<KeapSubscription>(
      `/subscriptions/${subscriptionId}`
    );
    return response;
  }

  // Alternative: Add credit to account instead of changing dates
  async addCredit(contactId: string, amount: number, description: string): Promise<any> {
    // This would add a credit to the customer's account
    // Credits are automatically applied to the next invoice
    const response = await this.makeRequest(
      `/transactions`,
      {
        method: 'POST',
        body: JSON.stringify({
          contact_id: contactId,
          amount: amount,
          type: 'CREDIT',
          description: description,
          date: new Date().toISOString()
        })
      }
    );
    return response;
  }

  // Pause subscription - NOTE: Direct date modification not supported in REST API v2
  async pauseSubscription(subscriptionId: string, pauseDays: number = 7): Promise<{ 
    subscription: KeapSubscription; 
    oldNextBillDate: string; 
    newNextBillDate: string;
    alternative: string;
  }> {
    // Get current subscription details
    const subscription = await this.getSubscription(subscriptionId);
    const oldNextBillDate = subscription.next_bill_date || subscription.start_date;
    
    // Calculate what the new date would be
    const currentNextBillDate = new Date(oldNextBillDate);
    currentNextBillDate.setDate(currentNextBillDate.getDate() + pauseDays);
    
    // Ensure the new date is on a Thursday (day 4)
    const dayOfWeek = currentNextBillDate.getDay();
    if (dayOfWeek !== 4) {
      const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7;
      currentNextBillDate.setDate(currentNextBillDate.getDate() + daysUntilThursday);
    }
    
    const newNextBillDate = currentNextBillDate.toISOString();
    
    // Calculate credit amount (weekly billing)
    const weeksToCredit = Math.ceil(pauseDays / 7);
    const creditAmount = subscription.billing_amount * weeksToCredit;
    
    return {
      subscription: subscription,
      oldNextBillDate,
      newNextBillDate,
      alternative: `Cannot modify date directly. Option: Add credit of $${creditAmount} for ${weeksToCredit} weeks, or use XML-RPC API, or implement cancel/recreate workflow.`
    };
  }
}
