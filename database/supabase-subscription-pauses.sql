-- Supabase Schema for Subscription Pause Tracking
-- This creates a comprehensive audit trail for all subscription modifications

-- Create the subscription_pauses table
CREATE TABLE IF NOT EXISTS subscription_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Keap subscription details
  subscription_id TEXT NOT NULL,
  customer_id TEXT,
  contact_id TEXT,
  
  -- Pause details
  pause_days INTEGER NOT NULL,
  old_next_bill_date TIMESTAMP WITH TIME ZONE NOT NULL,
  new_next_bill_date TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Request metadata
  reason TEXT,
  request_source TEXT DEFAULT 'api', -- 'api', 'membership_portal', 'admin', 'keap_campaign'
  request_ip TEXT,
  user_agent TEXT,
  
  -- Status tracking
  status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'failed', 'reversed'
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Create indexes for common queries
  INDEX idx_subscription_id ON subscription_pauses(subscription_id),
  INDEX idx_customer_id ON subscription_pauses(customer_id),
  INDEX idx_created_at ON subscription_pauses(created_at DESC),
  INDEX idx_status ON subscription_pauses(status)
);

-- Create a view for easy reporting
CREATE OR REPLACE VIEW subscription_pause_summary AS
SELECT 
  sp.id,
  sp.subscription_id,
  sp.customer_id,
  sp.pause_days,
  sp.old_next_bill_date,
  sp.new_next_bill_date,
  sp.reason,
  sp.status,
  sp.created_at,
  DATE_PART('day', sp.new_next_bill_date - sp.old_next_bill_date) as actual_days_paused,
  CASE 
    WHEN sp.pause_days > 0 THEN 'pause'
    WHEN sp.pause_days < 0 THEN 'expedite'
    ELSE 'no_change'
  END as pause_type
FROM subscription_pauses sp
ORDER BY sp.created_at DESC;

-- Create a function to calculate pause statistics
CREATE OR REPLACE FUNCTION get_pause_statistics(
  start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
  end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  total_pauses BIGINT,
  total_expedites BIGINT,
  avg_pause_days NUMERIC,
  most_common_reason TEXT,
  pauses_by_source JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(CASE WHEN pause_days > 0 THEN 1 END) as total_pauses,
    COUNT(CASE WHEN pause_days < 0 THEN 1 END) as total_expedites,
    AVG(ABS(pause_days))::NUMERIC(10,2) as avg_pause_days,
    MODE() WITHIN GROUP (ORDER BY reason) as most_common_reason,
    jsonb_object_agg(
      request_source, 
      COUNT(*)
    ) FILTER (WHERE request_source IS NOT NULL) as pauses_by_source
  FROM subscription_pauses
  WHERE created_at BETWEEN start_date AND end_date
    AND status = 'completed';
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_subscription_pauses_updated_at 
  BEFORE UPDATE ON subscription_pauses 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Create RLS (Row Level Security) policies if needed
ALTER TABLE subscription_pauses ENABLE ROW LEVEL SECURITY;

-- Example policy: Allow authenticated users to read their own pause history
CREATE POLICY "Users can view their own pause history" 
  ON subscription_pauses
  FOR SELECT
  USING (auth.uid()::TEXT = customer_id);

-- Example policy: Allow service role full access
CREATE POLICY "Service role has full access" 
  ON subscription_pauses
  FOR ALL
  USING (auth.role() = 'service_role');

-- Comments for documentation
COMMENT ON TABLE subscription_pauses IS 'Audit trail for all subscription pause/modification requests';
COMMENT ON COLUMN subscription_pauses.pause_days IS 'Number of days to pause (positive) or expedite (negative)';
COMMENT ON COLUMN subscription_pauses.request_source IS 'Origin of the pause request: api, membership_portal, admin, keap_campaign';
COMMENT ON COLUMN subscription_pauses.status IS 'Status of the pause request: pending, completed, failed, reversed';

-- Sample query to get recent pauses for a customer
-- SELECT * FROM subscription_pause_summary WHERE customer_id = 'CUSTOMER_ID' LIMIT 10;

-- Sample query to get pause statistics for the last 30 days
-- SELECT * FROM get_pause_statistics();