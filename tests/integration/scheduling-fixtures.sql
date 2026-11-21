-- Solo datos sintéticos en la base desechable del runner PDGLD-135.
CREATE TABLE public.scheduling_fixture(actor uuid, outsider uuid, season uuid, category uuid, group_id uuid, reviewer uuid);
DO $$
DECLARE actor uuid; outsider uuid; p uuid; l uuid; sp uuid; s uuid; ca uuid; cr uuid; sc uuid; g uuid;
 c uuid; af uuid; t uuid; v uuid; r uuid; perm uuid; reviewer uuid; review_role uuid;
BEGIN
 INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Programador','Sintetico') RETURNING id INTO p;
 INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
 VALUES(p,'scheduler','scheduler@example.test','SYNTHETIC',false) RETURNING id INTO actor;
 INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Sin permiso','Sintetico') RETURNING id INTO p;
 INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
 VALUES(p,'outsider','outsider@example.test','SYNTHETIC',false) RETURNING id INTO outsider;
 PERFORM set_config('app.user_id',actor::text,true);
 PERFORM set_config('app.reason','Datos sinteticos de PDGLD-135',true);
 SELECT id INTO sp FROM sports_management.sports WHERE code='SOCCER';
 INSERT INTO sports_management.leagues(name) VALUES('Programacion sintetica') RETURNING id INTO l;
 INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
 VALUES(l,sp,'Temporada sintetica','2030-01-01','2030-12-31') RETURNING id INTO s;
 SELECT id INTO r FROM sports_management.roles WHERE code='LEAGUE_SECRETARY';
 IF r IS NULL THEN SELECT id INTO r FROM sports_management.roles LIMIT 1; END IF;
 INSERT INTO sports_management.permissions(module,action) VALUES('scheduling','CREATE') ON CONFLICT DO NOTHING;
 SELECT id INTO perm FROM sports_management.permissions WHERE module='scheduling' AND action='CREATE';
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(r,perm,true) ON CONFLICT DO NOTHING;
 INSERT INTO sports_management.permissions(module,action) VALUES('scheduling','UPDATE') ON CONFLICT DO NOTHING;
 SELECT id INTO perm FROM sports_management.permissions WHERE module='scheduling' AND action='UPDATE';
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(r,perm,true) ON CONFLICT DO NOTHING;
 INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES(actor,r,l);
 INSERT INTO sports_management.permissions(module,action) VALUES('scheduling','READ') ON CONFLICT DO NOTHING;
 SELECT id INTO perm FROM sports_management.permissions WHERE module='scheduling' AND action='READ';
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(r,perm,true) ON CONFLICT DO NOTHING;
 INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES(l,sp,'Abierta') RETURNING id INTO ca;
 INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES(s,1) RETURNING id INTO cr;
 INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by)
 VALUES(cr,'calendar','{"rounds":1,"matchDurationMinutes":90,"scheduling":{"slotStepMinutes":30,"venueStages":[]}}',actor);
 INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by) VALUES
 (cr,'announcement','"Reglamento sintético"',actor),
 (cr,'points','{"win":3,"draw":1,"loss":0}',actor),
 (cr,'tieBreakers','["GOAL_DIFFERENCE"]',actor);
 UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=actor,approved_at=now() WHERE id=cr;
 INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date,competition_format)
 VALUES(s,ca,cr,1,'OPEN','2030-12-31','GENERAL_TABLE') RETURNING id INTO sc;
 INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES(s,sc,'General') RETURNING id INTO g;
 FOR i IN 1..20 LOOP
  INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES(l,'Club '||i,gen_random_uuid()::text) RETURNING id INTO c;
  INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by)
  VALUES(s,c,l,gen_random_uuid()::text,'Azul','APPROVED',actor) RETURNING id INTO af;
  INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id,authorized_by,authorized_at) VALUES(af,s,ca,actor,now());
  INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES(c,gen_random_uuid()::text,'Equipo '||i) RETURNING id INTO t;
  INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id,season_category_id) VALUES(s,t,c,g,sc);
 END LOOP;
 FOR i IN 1..19 LOOP
  INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES(s,i,'2030-01-06'::date+(i-1)*7,'2030-01-06'::date+(i-1)*7);
 END LOOP;
 FOR venue_number IN 1..4 LOOP
 INSERT INTO sports_management.venues(league_id,code,name,address,is_league_sports_complex,match_duration_minutes,buffer_minutes)
 VALUES(l,'SYN'||venue_number,'Cancha sintetica','Direccion sintetica',true,90,30) RETURNING id INTO v;
 FOR i IN 1..19 LOOP
  INSERT INTO sports_management.venue_availability(venue_id,starts_at,ends_at,type)
  VALUES(v,'2030-01-06T15:00:00Z'::timestamptz+(i-1)*interval '7 days','2030-01-06T21:00:00Z'::timestamptz+(i-1)*interval '7 days','AVAILABLE');
 END LOOP;
 END LOOP;
 INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Presidencia','Sintetica') RETURNING id INTO p;
 INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
 VALUES(p,'reviewer','reviewer@example.test','SYNTHETIC',false) RETURNING id INTO reviewer;
 INSERT INTO sports_management.roles(code,name) VALUES('PDGLD25_REVIEW_TEST','Revisión sintética sin edición') RETURNING id INTO review_role;
 INSERT INTO sports_management.permissions(module,action) VALUES('scheduling','APPROVE') ON CONFLICT DO NOTHING;
 SELECT id INTO perm FROM sports_management.permissions WHERE module='scheduling' AND action='APPROVE';
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(review_role,perm,true);
 INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES(reviewer,review_role,l);
 INSERT INTO public.scheduling_fixture VALUES(actor,outsider,s,sc,g,reviewer);
END $$;
