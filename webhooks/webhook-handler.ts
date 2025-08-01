import { DataSync } from '../sync/data-sync';
import { CacheService } from '../cache/cache-service';

export interface WebhookPayload {
  event_type: string;
  object_type: string;
  object_keys: {
    id: string;
    [key: string]: any;
  };
  timestamp: string;
}

export class WebhookHandler {
  constructor(
    private db: D1Database,
    private cache: CacheService,
    private dataSync: DataSync
  ) {}

  async handleWebhook(payload: WebhookPayload): Promise<void> {
    console.log(`Processing webhook: ${payload.event_type} for ${payload.object_type}`);
    
    switch (payload.object_type) {
      case 'contact':
        await this.handleContactWebhook(payload);
        break;
      case 'order':
        await this.handleOrderWebhook(payload);
        break;
      case 'subscription':
        await this.handleSubscriptionWebhook(payload);
        break;
      case 'product':
        await this.handleProductWebhook(payload);
        break;
      default:
        console.log(`Unhandled webhook type: ${payload.object_type}`);
    }

    // Invalidate relevant caches
    await this.invalidateCaches(payload.object_type);
  }

  private async handleContactWebhook(payload: WebhookPayload): Promise<void> {
    const contactId = payload.object_keys.id;
    
    switch (payload.event_type) {
      case 'contact.add':
      case 'contact.edit':
        // Sync single contact
        await this.syncSingleContact(contactId);
        break;
      case 'contact.delete':
        // Mark contact as deleted
        await this.db.prepare(`
          UPDATE contacts 
          SET lifecycle_stage = 'deleted', updated_at = CURRENT_TIMESTAMP 
          WHERE keap_contact_id = ?
        `).bind(contactId).run();
        break;
    }
  }

  private async handleOrderWebhook(payload: WebhookPayload): Promise<void> {
    const orderId = payload.object_keys.id;
    
    switch (payload.event_type) {
      case 'order.add':
      case 'order.edit':
        // Sync single order
        await this.syncSingleOrder(orderId);
        break;
      case 'order.delete':
        // Delete order
        await this.db.prepare(`
          DELETE FROM orders WHERE keap_order_id = ?
        `).bind(orderId).run();
        break;
    }
  }

  private async handleSubscriptionWebhook(payload: WebhookPayload): Promise<void> {
    const subscriptionId = payload.object_keys.id;
    
    switch (payload.event_type) {
      case 'subscription.add':
      case 'subscription.edit':
        // Sync single subscription
        await this.syncSingleSubscription(subscriptionId);
        break;
      case 'subscription.delete':
        // Update subscription status
        await this.db.prepare(`
          UPDATE subscriptions 
          SET status = 'cancelled', end_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
          WHERE keap_subscription_id = ?
        `).bind(subscriptionId).run();
        break;
    }
  }

  private async handleProductWebhook(payload: WebhookPayload): Promise<void> {
    const productId = payload.object_keys.id;
    
    switch (payload.event_type) {
      case 'product.add':
      case 'product.edit':
        // Sync single product
        await this.syncSingleProduct(productId);
        break;
      case 'product.delete':
        // Mark product as inactive
        await this.db.prepare(`
          UPDATE products 
          SET active = 0, updated_at = CURRENT_TIMESTAMP 
          WHERE keap_product_id = ?
        `).bind(productId).run();
        break;
    }
  }

  private async syncSingleContact(contactId: string): Promise<void> {
    // This would fetch a single contact from Keap API and update
    // For now, we'll use the batch sync
    console.log(`Would sync single contact: ${contactId}`);
  }

  private async syncSingleOrder(orderId: string): Promise<void> {
    console.log(`Would sync single order: ${orderId}`);
  }

  private async syncSingleSubscription(subscriptionId: string): Promise<void> {
    console.log(`Would sync single subscription: ${subscriptionId}`);
  }

  private async syncSingleProduct(productId: string): Promise<void> {
    console.log(`Would sync single product: ${productId}`);
  }

  private async invalidateCaches(objectType: string): Promise<void> {
    // Invalidate relevant cache keys
    await Promise.all([
      this.cache.deletePattern('metrics'),
      this.cache.deletePattern('dashboard'),
      this.cache.deletePattern(objectType)
    ]);
  }

  // Verify webhook signature
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    // Keap uses HMAC-SHA256 for webhook signatures
    // This would need to be implemented based on Keap's documentation
    return true; // Placeholder
  }
}

// Webhook registration helper
export class WebhookRegistration {
  static getWebhookUrl(baseUrl: string): string {
    return `${baseUrl}/api/webhooks/keap`;
  }

  static getWebhookConfig() {
    return {
      eventKeys: [
        'contact.add',
        'contact.edit',
        'contact.delete',
        'order.add',
        'order.edit',
        'order.delete',
        'subscription.add',
        'subscription.edit',
        'subscription.delete',
        'product.add',
        'product.edit',
        'product.delete'
      ],
      hookUrl: 'https://d1-starter-sessions-api.megan-d14.workers.dev/api/webhooks/keap'
    };
  }
}