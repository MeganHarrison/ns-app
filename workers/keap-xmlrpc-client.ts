// Keap XML-RPC Client for subscription date modifications
// This uses the legacy XML-RPC API which supports direct billing date updates

export class KeapXMLRPCClient {
  private apiKey: string;
  private endpoint = 'https://api.infusionsoft.com/crm/xmlrpc/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // Build XML-RPC request
  private buildXMLRPCRequest(methodName: string, params: any[]): string {
    const xmlParams = params.map(param => this.valueToXML(param)).join('');
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>${methodName}</methodName>
  <params>
    ${xmlParams}
  </params>
</methodCall>`;
  }

  // Convert JavaScript values to XML-RPC format
  private valueToXML(value: any): string {
    if (value === null || value === undefined) {
      return '<param><value><nil/></value></param>';
    }
    
    if (typeof value === 'string') {
      return `<param><value><string><![CDATA[${value}]]></string></value></param>`;
    }
    
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return `<param><value><i4>${value}</i4></value></param>`;
      }
      return `<param><value><double>${value}</double></value></param>`;
    }
    
    if (typeof value === 'boolean') {
      return `<param><value><boolean>${value ? '1' : '0'}</boolean></value></param>`;
    }
    
    if (value instanceof Date) {
      // Format: YYYYMMDDTHH:MM:SS
      const dateStr = value.toISOString().replace(/[-:]/g, '').split('.')[0];
      return `<param><value><dateTime.iso8601>${dateStr}</dateTime.iso8601></value></param>`;
    }
    
    if (Array.isArray(value)) {
      const arrayValues = value.map(v => this.valueToXML(v).replace(/<\/?param>/g, '')).join('');
      return `<param><value><array><data>${arrayValues}</data></array></value></param>`;
    }
    
    if (typeof value === 'object') {
      const members = Object.entries(value).map(([k, v]) => {
        const memberValue = this.valueToXML(v).replace(/<\/?param>/g, '');
        return `<member><name>${k}</name>${memberValue}</member>`;
      }).join('');
      return `<param><value><struct>${members}</struct></value></param>`;
    }
    
    return `<param><value><string>${String(value)}</string></value></param>`;
  }

  // Parse XML-RPC response
  private parseXMLRPCResponse(xml: string): any {
    // Basic XML parsing for the response
    // In production, you'd want to use a proper XML parser
    
    // Check for fault
    if (xml.includes('<fault>')) {
      const faultMatch = xml.match(/<name>faultString<\/name>\s*<value>\s*<string>([^<]+)<\/string>/);
      const codeMatch = xml.match(/<name>faultCode<\/name>\s*<value>\s*<i4>([^<]+)<\/i4>/);
      throw new Error(`XML-RPC Fault ${codeMatch ? codeMatch[1] : 'unknown'}: ${faultMatch ? faultMatch[1] : 'Unknown error'}`);
    }
    
    // Extract the value
    const valueMatch = xml.match(/<methodResponse>\s*<params>\s*<param>\s*<value>([^]+)<\/value>\s*<\/param>/);
    if (!valueMatch) {
      throw new Error('Invalid XML-RPC response');
    }
    
    return this.parseValue(valueMatch[1]);
  }

  // Parse individual XML-RPC values
  private parseValue(xml: string): any {
    // String
    if (xml.includes('<string>')) {
      const match = xml.match(/<string>(?:<!\[CDATA\[)?([^<]+)(?:\]\]>)?<\/string>/);
      return match ? match[1] : '';
    }
    
    // Integer
    if (xml.includes('<i4>') || xml.includes('<int>')) {
      const match = xml.match(/<(?:i4|int)>([^<]+)<\/(?:i4|int)>/);
      return match ? parseInt(match[1]) : 0;
    }
    
    // Boolean
    if (xml.includes('<boolean>')) {
      const match = xml.match(/<boolean>([01])<\/boolean>/);
      return match ? match[1] === '1' : false;
    }
    
    // Double
    if (xml.includes('<double>')) {
      const match = xml.match(/<double>([^<]+)<\/double>/);
      return match ? parseFloat(match[1]) : 0;
    }
    
    // Date
    if (xml.includes('<dateTime.iso8601>')) {
      const match = xml.match(/<dateTime\.iso8601>([^<]+)<\/dateTime\.iso8601>/);
      if (match) {
        // Parse YYYYMMDDTHH:MM:SS format
        const dateStr = match[1];
        const year = dateStr.substr(0, 4);
        const month = dateStr.substr(4, 2);
        const day = dateStr.substr(6, 2);
        const hour = dateStr.substr(9, 2);
        const minute = dateStr.substr(12, 2);
        const second = dateStr.substr(15, 2);
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
      }
    }
    
    // Default to string
    return xml;
  }

  // Make XML-RPC call
  private async call(method: string, params: any[]): Promise<any> {
    const xmlRequest = this.buildXMLRPCRequest(method, params);
    
    console.log('XML-RPC Request:', xmlRequest);
    
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Accept': 'text/xml'
      },
      body: xmlRequest
    });
    
    const responseText = await response.text();
    console.log('XML-RPC Response:', responseText);
    
    if (!response.ok) {
      throw new Error(`XML-RPC HTTP error: ${response.status} ${response.statusText}`);
    }
    
    return this.parseXMLRPCResponse(responseText);
  }

  // Update subscription next bill date
  async updateSubscriptionNextBillDate(subscriptionId: number, nextBillDate: Date): Promise<boolean> {
    try {
      // RecurringOrderService.updateSubscriptionNextBillDate
      // Parameters: apiKey, subscriptionId, nextBillDate
      const result = await this.call('RecurringOrderService.updateSubscriptionNextBillDate', [
        this.apiKey,
        subscriptionId,
        nextBillDate
      ]);
      
      return result === true || result === 1;
    } catch (error) {
      console.error('Failed to update subscription next bill date:', error);
      throw error;
    }
  }

  // Get subscription info using XML-RPC
  async getRecurringOrder(subscriptionId: number): Promise<any> {
    try {
      // RecurringOrderService.getRecurringOrder
      // Parameters: apiKey, recurringOrderId
      const result = await this.call('RecurringOrderService.getRecurringOrder', [
        this.apiKey,
        subscriptionId
      ]);
      
      return result;
    } catch (error) {
      console.error('Failed to get recurring order:', error);
      throw error;
    }
  }

  // Pause subscription using updateSubscriptionPauseResume
  async pauseSubscription(subscriptionId: number, pauseUntilDate: Date): Promise<boolean> {
    try {
      // RecurringOrderService.updateSubscriptionPauseResume
      // Parameters: apiKey, subscriptionId, pauseUntilDate
      const result = await this.call('RecurringOrderService.updateSubscriptionPauseResume', [
        this.apiKey,
        subscriptionId,
        pauseUntilDate
      ]);
      
      return result === true || result === 1;
    } catch (error) {
      console.error('Failed to pause subscription:', error);
      throw error;
    }
  }
}

// Helper function to format date for Keap
export function formatDateForKeap(date: Date): Date {
  // Ensure the date is at midnight UTC
  const keapDate = new Date(date);
  keapDate.setUTCHours(0, 0, 0, 0);
  return keapDate;
}