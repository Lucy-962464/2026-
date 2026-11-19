CREATE OR REPLACE FUNCTION cleanup_stale_attempts(p_participant_id BIGINT, p_keep_session_id BIGINT DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cnt INT;
BEGIN
  UPDATE task_attempts
  SET status = 'interrupted', interrupted_reason = COALESCE(interrupted_reason, 'abandoned')
  WHERE participant_id = p_participant_id AND status = 'in_progress'
    AND session_id <> COALESCE(p_keep_session_id, -1);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END;
$$;
