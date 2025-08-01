import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export interface SupabaseOrder {
  id?: string;
  company_id: string;
  keap_order_id: string;
  contact_id?: string;
  total_amount: number;
  status: string;
  order_date: string;
  products: any[];
  shipping_address: any;
  billing_address: any;
  created_at?: string;
  updated_at?: string;
}

export class SupabaseService {
  private client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
  }

  async syncOrders(orders: SupabaseOrder[]): Promise<{ success: boolean; synced: number; errors: any[] }> {
    try {
      // Batch upsert orders to Supabase
      const { data, error } = await this.client
        .from('orders')
        .upsert(orders, {
          onConflict: 'keap_order_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Supabase sync error:', error);
        return { success: false, synced: 0, errors: [error] };
      }

      return { success: true, synced: orders.length, errors: [] };
    } catch (error) {
      console.error('Unexpected error during sync:', error);
      return { success: false, synced: 0, errors: [error] };
    }
  }

  async getLatestOrderDate(companyId: string): Promise<Date | null> {
    try {
      const { data, error } = await this.client
        .from('orders')
        .select('order_date')
        .eq('company_id', companyId)
        .order('order_date', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      return new Date(data.order_date);
    } catch (error) {
      console.error('Error getting latest order date:', error);
      return null;
    }
  }

  async getOrderCount(companyId: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);

      if (error) {
        console.error('Error getting order count:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error getting order count:', error);
      return 0;
    }
  }

  async syncSingleOrder(order: SupabaseOrder): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('orders')
        .upsert([order], {
          onConflict: 'keap_order_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Error syncing single order:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Unexpected error syncing single order:', error);
      return false;
    }
  }
}