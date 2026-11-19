CREATE OR REPLACE FUNCTION create_attempt(
  p_session_id BIGINT, p_participant_id BIGINT, p_template_id BIGINT,
  p_sequence_no INT, p_is_practice BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  v_template RECORD;
  v_group_ids JSONB;
  v_items JSONB;
  v_attempt_id BIGINT;
BEGIN
  SELECT * INTO v_template FROM task_templates WHERE id = p_template_id;
  IF v_template.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'template_not_found');
  END IF;

  SELECT material_ids INTO v_group_ids FROM material_groups WHERE id = v_template.material_group_id;
  IF v_group_ids IS NULL OR jsonb_array_length(v_group_ids) < v_template.n_items THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'material_group_insufficient');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'emoji', m.emoji)), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT m.id, m.name, m.emoji
    FROM materials m
    WHERE m.status = 'active'
      AND m.id::TEXT IN (SELECT jsonb_array_elements_text(v_group_ids))
    ORDER BY random()
    LIMIT v_template.n_items
  ) m;

  IF jsonb_array_length(v_items) < v_template.n_items THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active_materials_insufficient');
  END IF;

  INSERT INTO task_attempts (session_id, participant_id, template_id, template_version, material_group_id, sequence_no, is_practice, status, presented_items, total_items)
  VALUES (p_session_id, p_participant_id, p_template_id, v_template.version, v_template.material_group_id, p_sequence_no, p_is_practice, 'in_progress', v_items, jsonb_array_length(v_items))
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object('ok', true, 'attempt_id', v_attempt_id, 'presented_items', v_items,
    'n_items', v_template.n_items, 'present_ms', v_template.present_ms, 'retention_ms', v_template.retention_ms,
    'instruction', v_template.instruction, 'template_name', v_template.name, 'difficulty', v_template.difficulty);
END;
$$;
