BEGIN;

-- Solo una llave de liguilla registrada permite equipos de distintos grupos.
-- El club que presenta al árbitro no puede pertenecer a ninguno de los grupos.
CREATE OR REPLACE FUNCTION sports_management.referee_assignment_blockers(mid uuid,rid uuid,aid uuid DEFAULT NULL)
 RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m record; r record; c record; codes text[]:='{}'; is_playoff boolean;
BEGIN
 SELECT ma.*,s.league_id,s.status AS season_status,s.start_date AS season_start,s.end_date AS season_end,l.timezone,g.season_category_id,sc.category_id,
  ms.code AS match_status INTO m FROM sports_management.matches ma
 JOIN sports_management.seasons s ON s.id=ma.season_id JOIN sports_management.leagues l ON l.id=s.league_id JOIN sports_management.groups g ON g.id=ma.group_id AND g.season_id=ma.season_id
 JOIN sports_management.season_categories sc ON sc.id=g.season_category_id AND sc.season_id=ma.season_id
 JOIN sports_management.match_statuses ms ON ms.id=ma.status_id WHERE ma.id=mid;
 SELECT * INTO r FROM sports_management.referees WHERE id=rid;
 IF m.id IS NULL OR r.id IS NULL THEN RETURN ARRAY['INVALID_CONTEXT']; END IF;
 SELECT EXISTS(SELECT 1 FROM sports_management.competition_stages cs
  JOIN sports_management.brackets b ON b.stage_id=cs.id AND b.season_id=cs.season_id
  JOIN sports_management.bracket_matches bm ON bm.bracket_id=b.id AND bm.match_id=m.id
  WHERE cs.id=m.stage_id AND cs.season_id=m.season_id AND cs.season_category_id=m.season_category_id
   AND cs.format->>'kind'='PLAYOFF_8' AND b.number BETWEEN 1 AND 7
   AND b.team_a_id IS NOT NULL AND b.team_b_id IS NOT NULL
   AND ((b.team_a_id=m.home_team_id AND b.team_b_id=m.away_team_id) OR (b.team_b_id=m.home_team_id AND b.team_a_id=m.away_team_id))) INTO is_playoff;
 IF m.season_status='CLOSED' OR m.match_status IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') THEN codes:=array_append(codes,'CLOSED_CONTEXT'); END IF;
 IF m.deleted_at IS NOT NULL OR m.match_status IN ('CANCELED','UNSCHEDULED','DRAFT') THEN codes:=array_append(codes,'MATCH_NOT_SCHEDULED'); END IF;
 IF NOT r.is_active THEN codes:=array_append(codes,'INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM sports_management.leagues WHERE id=m.league_id AND is_active) THEN codes:=array_append(codes,'INACTIVE_LEAGUE'); END IF;
 SELECT csr.*,ca.status AS affiliation_status,cl.status AS club_status,cl.league_id INTO c
 FROM sports_management.club_season_referees csr JOIN sports_management.club_affiliations ca ON ca.club_id=csr.club_id AND ca.season_id=csr.season_id
 JOIN sports_management.clubs cl ON cl.id=csr.club_id WHERE csr.referee_id=rid AND csr.season_id=m.season_id;
 IF c.id IS NULL OR c.affiliation_status<>'APPROVED' OR c.club_status<>'ACTIVE' OR c.league_id<>m.league_id THEN codes:=array_append(codes,'INVALID_PRESENTATION'); END IF;
 IF EXISTS(SELECT 1 FROM sports_management.season_teams st WHERE st.season_id=m.season_id AND st.club_id=c.club_id
  AND (st.group_id=m.group_id OR (is_playoff AND st.group_id IN (SELECT participant.group_id FROM sports_management.season_teams participant WHERE participant.id IN (m.home_team_id,m.away_team_id) AND participant.season_id=m.season_id))))
 THEN codes:=array_append(codes,'CLUB_IN_GROUP'); END IF;
 IF (SELECT count(*) FROM sports_management.season_teams st JOIN sports_management.teams t ON t.id=st.team_id
  JOIN sports_management.club_affiliations ca ON ca.club_id=st.club_id AND ca.season_id=st.season_id
  JOIN sports_management.clubs tc ON tc.id=st.club_id
  WHERE st.id IN (m.home_team_id,m.away_team_id) AND st.season_id=m.season_id AND (is_playoff OR st.group_id=m.group_id)
   AND st.season_category_id=m.season_category_id AND st.status IN ('REGISTERED','ACTIVE') AND t.status='ACTIVE' AND tc.status='ACTIVE' AND ca.status='APPROVED')<>2
 THEN codes:=array_append(codes,'INVALID_TEAMS'); END IF;
 IF m.starts_at IS NULL OR m.ends_at IS NULL OR m.ends_at<=m.starts_at THEN codes:=array_append(codes,'INVALID_TIME');
 ELSE
  IF (m.starts_at AT TIME ZONE m.timezone)::date NOT BETWEEN m.season_start AND m.season_end OR (m.ends_at AT TIME ZONE m.timezone)::date NOT BETWEEN m.season_start AND m.season_end THEN codes:=array_append(codes,'INVALID_TIME'); END IF;
  IF EXISTS(SELECT 1 FROM sports_management.referee_availability WHERE referee_id=rid AND NOT is_available AND starts_at<m.ends_at AND ends_at>m.starts_at) THEN codes:=array_append(codes,'UNAVAILABLE');
  ELSIF NOT coalesce((SELECT range_agg(tstzrange(starts_at,ends_at,'[)')) @> tstzrange(m.starts_at,m.ends_at,'[)') FROM sports_management.referee_availability WHERE referee_id=rid AND is_available),false) THEN codes:=array_append(codes,'UNKNOWN_AVAILABILITY'); END IF;
  IF EXISTS(SELECT 1 FROM sports_management.referee_assignments a JOIN sports_management.matches om ON om.id=a.match_id
   JOIN sports_management.match_statuses os ON os.id=om.status_id
   WHERE a.referee_id=rid AND a.status='APPROVED' AND a.id IS DISTINCT FROM aid AND om.deleted_at IS NULL
   AND os.code<>'CANCELED' AND om.starts_at<m.ends_at AND om.ends_at>m.starts_at) THEN codes:=array_append(codes,'OVERLAP'); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM sports_management.referee_assignments WHERE match_id=mid AND referee_id=rid AND status<>'REVOKED' AND id IS DISTINCT FROM aid) THEN codes:=array_append(codes,'DUPLICATE'); END IF;
 IF EXISTS(SELECT 1 FROM sports_management.referee_assignments WHERE match_id=mid AND assignment_role='MAIN' AND status='APPROVED' AND id IS DISTINCT FROM aid) THEN codes:=array_append(codes,'SLOT_TAKEN'); END IF;
 RETURN codes;
END $$;

COMMIT;
