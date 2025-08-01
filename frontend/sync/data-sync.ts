import { KeapClient, KeapContact, KeapProduct, KeapSubscription, KeapOrder } from '../keap-client';

export interface SyncResult {
  entity: string;
  synced: number;
  failed: number;
  errors: string[];
  duration: number;
}

export class DataSync {
  constructor(
    private keapClient: KeapClient,
    private db: D1Database,
    private companyId: string = 'default-company'
  ) {}

  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    
    // Sync in order of dependencies
    results.push(await this.syncContacts());
    results.push(await this.syncProducts());
    results.push(await this.syncOrders());
    results.push(await this.syncSubscriptions());
    
    // Log overall sync
    await this.logSync('full_sync', 'completed', results);
    
    return results;
  }

  async syncContacts(): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    try {
      // Log sync start
      const syncLogId = await this.logSync('contacts', 'started');
      
      // Fetch all contacts from Keap
      const contacts = await this.keapClient.getAllContacts();
      
      // Sync each contact
      for (const contact of contacts) {
        try {
          await this.db.prepare(`
            INSERT OR REPLACE INTO contacts (
              company_id, keap_contact_id, email, first_name, last_name,
              phone, tags, custom_fields, lifecycle_stage,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            this.companyId,
            contact.id,
            contact.email || null,
            contact.given_name || null,
            contact.family_name || null,
            contact.phone_number || null,
            JSON.stringify(contact.tag_ids || []),
            JSON.stringify(contact.custom_fields || {}),
            contact.lifecycle_stage || null,
            contact.date_created || new Date().toISOString()
          ).run();
          
          synced++;
        } catch (error) {
          failed++;
          errors.push(`Contact ${contact.id}: ${error.message}`);
        }
      }
      
      // Update sync log
      await this.updateSyncLog(syncLogId, 'completed', synced, errors);
      
    } catch (error) {
      errors.push(`Fatal error: ${error.message}`);
    }

    return {
      entity: 'contacts',
      synced,
      failed,
      errors,
      duration: Date.now() - startTime
    };
  }

  async syncProducts(): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    try {
      const syncLogId = await this.logSync('products', 'started');
      const products = await this.keapClient.getAllProducts();
      
      for (const product of products) {
        try {
          await this.db.prepare(`
            INSERT OR REPLACE INTO products (
              company_id, keap_product_id, name, description,
              price, category, sku, active,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).bind(
            this.companyId,
            product.id,
            product.name,
            product.description || null,
            product.price,
            product.product_category || null,
            product.sku || null,
            product.active ? 1 : 0
          ).run();
          
          synced++;
        } catch (error) {
          failed++;
          errors.push(`Product ${product.id}: ${error.message}`);
        }
      }
      
      await this.updateSyncLog(syncLogId, 'completed', synced, errors);
      
    } catch (error) {
      errors.push(`Fatal error: ${error.message}`);
    }

    return {
      entity: 'products',
      synced,
      failed,
      errors,
      duration: Date.now() - startTime
    };
  }

  async syncOrders(): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    try {
      const syncLogId = await this.logSync('orders', 'started');
      const orders = await this.keapClient.getAllOrders();
      
      for (const order of orders) {
        try {
          // First ensure contact exists
          const contactId = await this.ensureContact(order.contact);
          
          // Then sync the order
          await this.db.prepare(`
            INSERT OR REPLACE INTO orders (
              company_id, keap_order_id, contact_id,
              total_amount, status, order_date, products,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            this.companyId,
            order.id,
            contactId,
            order.total.amount,
            order.status,
            order.order_time || order.creation_time || new Date().toISOString(),
            JSON.stringify(order.order_items || []),
            order.creation_time || new Date().toISOString()
          ).run();
          
          synced++;
        } catch (error) {
          failed++;
          errors.push(`Order ${order.id}: ${error.message}`);
        }
      }
      
      await this.updateSyncLog(syncLogId, 'completed', synced, errors);
      
    } catch (error) {
      errors.push(`Fatal error: ${error.message}`);
    }

    return {
      entity: 'orders',
      synced,
      failed,
      errors,
      duration: Date.now() - startTime
    };
  }

  async syncSubscriptions(): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    try {
      const syncLogId = await this.logSync('subscriptions', 'started');
      const subscriptions = await this.keapClient.getAllSubscriptions();
      
      for (const subscription of subscriptions) {
        try {
          // Get contact internal ID
          const contact = await this.db.prepare(`
            SELECT id FROM contacts WHERE keap_contact_id = ?
          `).bind(subscription.contact_id).first();
          
          // Get product internal ID
          const product = await this.db.prepare(`
            SELECT id FROM products WHERE keap_product_id = ?
          `).bind(subscription.product_id).first();
          
          if (!contact || !product) {
            throw new Error(`Missing contact or product for subscription ${subscription.id}`);
          }
          
          await this.db.prepare(`
            INSERT OR REPLACE INTO subscriptions (
              company_id, keap_subscription_id, contact_id, product_id,
              status, billing_amount, billing_cycle,
              start_date, next_billing_date, end_date,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).bind(
            this.companyId,
            subscription.id,
            contact.id,
            product.id,
            subscription.status,
            subscription.billing_amount,
            subscription.billing_cycle,
            subscription.start_date,
            subscription.next_bill_date || null,
            subscription.end_date || null
          ).run();
          
          synced++;
        } catch (error) {
          failed++;
          errors.push(`Subscription ${subscription.id}: ${error.message}`);
        }
      }
      
      await this.updateSyncLog(syncLogId, 'completed', synced, errors);
      
    } catch (error) {
      errors.push(`Fatal error: ${error.message}`);
    }

    return {
      entity: 'subscriptions',
      synced,
      failed,
      errors,
      duration: Date.now() - startTime
    };
  }

  private async ensureContact(contact: any): Promise<string> {
    // Check if contact exists
    const existing = await this.db.prepare(`
      SELECT id FROM contacts WHERE keap_contact_id = ?
    `).bind(contact.id).first();
    
    if (existing) {
      return existing.id;
    }
    
    // Create contact if not exists
    const contactId = crypto.randomUUID();
    await this.db.prepare(`
      INSERT INTO contacts (
        id, company_id, keap_contact_id, email,
        first_name, last_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      contactId,
      this.companyId,
      contact.id,
      contact.email || null,
      contact.given_name || null,
      contact.family_name || null
    ).run();
    
    return contactId;
  }

  private async logSync(syncType: string, status: string, results?: SyncResult[]): Promise<string> {
    const syncLogId = crypto.randomUUID();
    
    const recordsProcessed = results?.reduce((sum, r) => sum + r.synced, 0) || 0;
    const allErrors = results?.flatMap(r => r.errors) || [];
    
    await this.db.prepare(`
      INSERT INTO sync_logs (
        id, company_id, sync_type, status,
        records_processed, errors, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      syncLogId,
      this.companyId,
      syncType,
      status,
      recordsProcessed,
      JSON.stringify(allErrors)
    ).run();
    
    return syncLogId;
  }

  private async updateSyncLog(id: string, status: string, recordsProcessed: number, errors: string[]): Promise<void> {
    await this.db.prepare(`
      UPDATE sync_logs
      SET status = ?, records_processed = ?, errors = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      status,
      recordsProcessed,
      JSON.stringify(errors),
      id
    ).run();
  }
}