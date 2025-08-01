-- Supabase Subscriptions Table Schema
-- This creates a subscriptions table in your Supabase PostgreSQL database

-- Drop table if exists (be careful with this in production!)
-- DROP TABLE IF EXISTS subscriptions;

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Keap integration fields
  keap_subscription_id TEXT UNIQUE NOT NULL,
  
  -- Contact information
  contact_id TEXT NOT NULL,
  contact_email TEXT,
  contact_name TEXT,
  
  -- Product information
  product_id TEXT,
  product_name TEXT,
  
  -- Subscription details
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'cancelled', 'expired', 'pending')),
  billing_amount DECIMAL(10,2) NOT NULL,
  billing_cycle TEXT CHECK (billing_cycle IN ('weekly', 'monthly', 'quarterly', 'yearly', 'custom')),
  
  -- Important dates
  start_date TIMESTAMP WITH TIME ZONE,
  next_bill_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  last_payment_date TIMESTAMP WITH TIME ZONE,
  pause_date TIMESTAMP WITH TIME ZONE,
  resume_date TIMESTAMP WITH TIME ZONE,
  
  -- Payment information
  payment_method TEXT,
  last_payment_status TEXT,
  failed_payment_count INTEGER DEFAULT 0,
  
  -- Additional fields
  tags JSONB DEFAULT '[]'::jsonb,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_subscriptions_keap_id ON subscriptions(keap_subscription_id);
CREATE INDEX idx_subscriptions_contact_id ON subscriptions(contact_id);
CREATE INDEX idx_subscriptions_contact_email ON subscriptions(contact_email);
CREATE INDEX idx_subscriptions_product_id ON subscriptions(product_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_next_bill_date ON subscriptions(next_bill_date);
CREATE INDEX idx_subscriptions_start_date ON subscriptions(start_date);

-- Create partial indexes for common queries
CREATE INDEX idx_active_subscriptions ON subscriptions(next_bill_date) WHERE status = 'active';
CREATE INDEX idx_paused_subscriptions ON subscriptions(pause_date) WHERE status = 'paused';

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create view for active subscriptions with calculated fields
CREATE OR REPLACE VIEW active_subscriptions_summary AS
SELECT 
  s.*,
  -- Calculate days until next billing
  EXTRACT(DAY FROM (s.next_bill_date - CURRENT_TIMESTAMP)) AS days_until_billing,
  -- Calculate subscription age in days
  EXTRACT(DAY FROM (CURRENT_TIMESTAMP - s.start_date)) AS subscription_age_days,
  -- Calculate monthly recurring revenue (normalize to monthly)
  CASE 
    WHEN s.billing_cycle = 'weekly' THEN s.billing_amount * 4.33
    WHEN s.billing_cycle = 'monthly' THEN s.billing_amount
    WHEN s.billing_cycle = 'quarterly' THEN s.billing_amount / 3
    WHEN s.billing_cycle = 'yearly' THEN s.billing_amount / 12
    ELSE s.billing_amount
  END AS monthly_recurring_revenue
FROM subscriptions s
WHERE s.status = 'active';

-- Create materialized view for analytics (refresh periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS subscription_analytics AS
SELECT 
  DATE_TRUNC('month', start_date) AS month,
  COUNT(*) AS total_subscriptions,
  COUNT(*) FILTER (WHERE status = 'active') AS active_subscriptions,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_subscriptions,
  COUNT(*) FILTER (WHERE status = 'paused') AS paused_subscriptions,
  SUM(CASE 
    WHEN status = 'active' AND billing_cycle = 'weekly' THEN billing_amount * 4.33
    WHEN status = 'active' AND billing_cycle = 'monthly' THEN billing_amount
    WHEN status = 'active' AND billing_cycle = 'quarterly' THEN billing_amount / 3
    WHEN status = 'active' AND billing_cycle = 'yearly' THEN billing_amount / 12
    ELSE 0
  END) AS monthly_recurring_revenue,
  AVG(billing_amount) AS average_subscription_value
FROM subscriptions
GROUP BY DATE_TRUNC('month', start_date)
ORDER BY month DESC;

-- Create index on materialized view
CREATE INDEX idx_subscription_analytics_month ON subscription_analytics(month);

-- Grant permissions (adjust based on your Supabase auth setup)
GRANT ALL ON subscriptions TO authenticated;
GRANT ALL ON active_subscriptions_summary TO authenticated;
GRANT SELECT ON subscription_analytics TO authenticated;

-- Enable Row Level Security (RLS) - uncomment and modify based on your needs
-- ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (uncomment and modify as needed)
-- CREATE POLICY "Users can view all subscriptions" ON subscriptions
--   FOR SELECT USING (true);
-- 
-- CREATE POLICY "Service role can manage subscriptions" ON subscriptions
--   FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Useful queries:

-- Get all active subscriptions
-- SELECT * FROM subscriptions WHERE status = 'active' ORDER BY next_bill_date;

-- Get subscriptions billing in next 7 days
-- SELECT * FROM subscriptions 
-- WHERE status = 'active' 
-- AND next_bill_date BETWEEN NOW() AND NOW() + INTERVAL '7 days';

-- Get monthly recurring revenue
-- SELECT SUM(monthly_recurring_revenue) AS mrr FROM active_subscriptions_summary;

-- Get subscription metrics by product
-- SELECT 
--   product_name,
--   COUNT(*) as subscription_count,
--   SUM(monthly_recurring_revenue) as product_mrr
-- FROM active_subscriptions_summary
-- GROUP BY product_name
-- ORDER BY product_mrr DESC;