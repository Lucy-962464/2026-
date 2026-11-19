CREATE OR REPLACE FUNCTION interrupt_attempt(p_attempt_id BIGINT, p_reason TEXT DEFAULT 'exit')
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  UPDATE task_attempts
  SET status = 'interrupted', interrupted_reason = p_reason
  WHERE id = p_attempt_id AND status = 'in_progress'
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', v_id IS NOT NULL, 'id', v_id);
END;
$$;
