--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    actor character varying(200) NOT NULL,
    action character varying(50) NOT NULL,
    target_type character varying(30),
    target_id character varying(100),
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: batch_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_rows (
    id bigint NOT NULL,
    batch_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    row_no integer NOT NULL,
    data jsonb NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    doc_id character varying(100)
);


--
-- Name: batch_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.batch_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: batch_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.batch_rows_id_seq OWNED BY public.batch_rows.id;


--
-- Name: batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    file_name character varying(255),
    doc_type character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    valid_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    issued_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    issued_at timestamp with time zone,
    CONSTRAINT batches_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'pending_approval'::character varying, 'issued'::character varying, 'rejected'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: demo_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_tokens (
    id integer NOT NULL,
    token character varying(100),
    label text,
    name text,
    email text,
    company text,
    role text,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    max_uses integer DEFAULT 0,
    use_count integer DEFAULT 0,
    last_used_at timestamp with time zone,
    is_active boolean DEFAULT true,
    notes text,
    tenant_id uuid
);


--
-- Name: demo_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demo_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demo_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demo_tokens_id_seq OWNED BY public.demo_tokens.id;


--
-- Name: demo_visitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_visitors (
    id integer NOT NULL,
    full_name text,
    email text,
    company text,
    role text,
    ip_address text,
    user_agent text,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    page_views integer DEFAULT 1,
    tenant_id uuid
);


--
-- Name: demo_visitors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demo_visitors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demo_visitors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demo_visitors_id_seq OWNED BY public.demo_visitors.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doc_id character varying(64) NOT NULL,
    title character varying(255) NOT NULL,
    issued_to character varying(255) NOT NULL,
    issued_by character varying(255) NOT NULL,
    doc_type character varying(100),
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    expiry_date date,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid,
    replaces_doc_id character varying(64),
    superseded_by character varying(64),
    revoked_at timestamp with time zone,
    revoked_reason character varying(100),
    revoked_by uuid,
    issued_by_user uuid,
    batch_id uuid,
    CONSTRAINT documents_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying, 'expired'::character varying, 'superseded'::character varying])::text[])))
);


--
-- Name: print_specs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_specs (
    tenant_id uuid NOT NULL,
    doc_type character varying(100) NOT NULL,
    anchor character varying(12) DEFAULT 'bottom-right'::character varying NOT NULL,
    x_mm numeric(5,1) DEFAULT 15 NOT NULL,
    y_mm numeric(5,1) DEFAULT 15 NOT NULL,
    size_mm numeric(4,1) DEFAULT 30 NOT NULL,
    paper character varying(10) DEFAULT 'A4'::character varying NOT NULL,
    notes text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT print_specs_anchor_check CHECK (((anchor)::text = ANY ((ARRAY['top-left'::character varying, 'top-right'::character varying, 'bottom-left'::character varying, 'bottom-right'::character varying])::text[]))),
    CONSTRAINT print_specs_paper_check CHECK (((paper)::text = ANY ((ARRAY['A4'::character varying, 'A3'::character varying, 'Letter'::character varying])::text[]))),
    CONSTRAINT print_specs_size_mm_check CHECK (((size_mm >= (20)::numeric) AND (size_mm <= (60)::numeric))),
    CONSTRAINT print_specs_x_mm_check CHECK (((x_mm >= (0)::numeric) AND (x_mm <= (200)::numeric))),
    CONSTRAINT print_specs_y_mm_check CHECK (((y_mm >= (0)::numeric) AND (y_mm <= (280)::numeric)))
);


--
-- Name: scan_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_alerts (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    doc_id character varying(100) NOT NULL,
    kind character varying(20) NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    note text,
    CONSTRAINT scan_alerts_kind_check CHECK (((kind)::text = ANY ((ARRAY['many_scans'::character varying, 'many_places'::character varying, 'tampered'::character varying])::text[])))
);


--
-- Name: scan_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scan_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scan_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scan_alerts_id_seq OWNED BY public.scan_alerts.id;


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: signatories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signatories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    slot smallint NOT NULL,
    full_name character varying(200) NOT NULL,
    title character varying(200) NOT NULL,
    doc_types text[] DEFAULT '{}'::text[] NOT NULL,
    image_data bytea NOT NULL,
    image_mime character varying(20) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_by character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signatories_check CHECK (((effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT signatories_slot_check CHECK ((slot = ANY (ARRAY[1, 2])))
);


--
-- Name: student_claim_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_claim_codes (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    matric_number character varying(100) NOT NULL,
    code_hash character(64) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by integer,
    voided_at timestamp with time zone
);


--
-- Name: student_claim_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_claim_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_claim_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_claim_codes_id_seq OWNED BY public.student_claim_codes.id;


--
-- Name: student_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    file_name character varying(255),
    row_count integer DEFAULT 0 NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: student_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_records (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    list_id uuid,
    matric_number character varying(50) NOT NULL,
    full_name character varying(200) NOT NULL,
    programme character varying(200),
    faculty character varying(200),
    department character varying(200),
    degree_class character varying(100),
    entry_year character varying(4),
    graduation_year character varying(4),
    status character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    issued_at timestamp with time zone
);


--
-- Name: student_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_records_id_seq OWNED BY public.student_records.id;


--
-- Name: student_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_tokens (
    id integer NOT NULL,
    matric_number character varying(50) NOT NULL,
    institution character varying(100) NOT NULL,
    pin_hash character varying(255),
    token_balance integer DEFAULT 0 NOT NULL,
    email character varying(255),
    phone character varying(30),
    full_name character varying(255),
    notify_email boolean DEFAULT false,
    notify_sms boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pin_salt character varying(32),
    tenant_id uuid,
    verified_at timestamp with time zone,
    session_version integer DEFAULT 0 NOT NULL
);


--
-- Name: student_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_tokens_id_seq OWNED BY public.student_tokens.id;


--
-- Name: tenant_sign_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_sign_keys (
    tenant_id uuid NOT NULL,
    kid integer NOT NULL,
    master_ref character varying(40) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT tenant_sign_keys_master_ref_check CHECK (((master_ref)::text = ANY ((ARRAY['SIGNING_MASTER_KEY'::character varying, 'DOC_SECRET'::character varying])::text[]))),
    CONSTRAINT tenant_sign_keys_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'retired'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: tenant_sis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_sis (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    base_url character varying(500) NOT NULL,
    auth_type character varying(10) DEFAULT 'bearer'::character varying NOT NULL,
    secret_enc text,
    timeout_ms integer DEFAULT 5000 NOT NULL,
    last_ok_at timestamp with time zone,
    last_error text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_sis_auth_type_check CHECK (((auth_type)::text = ANY ((ARRAY['bearer'::character varying, 'basic'::character varying, 'none'::character varying])::text[]))),
    CONSTRAINT tenant_sis_timeout_ms_check CHECK (((timeout_ms >= 1000) AND (timeout_ms <= 15000)))
);


--
-- Name: tenant_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email character varying(200) NOT NULL,
    full_name character varying(200),
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    status character varying(20) DEFAULT 'invited'::character varying NOT NULL,
    password_hash text,
    totp_secret text,
    totp_enabled boolean DEFAULT false NOT NULL,
    recovery_codes text[] DEFAULT '{}'::text[] NOT NULL,
    invite_token_hash character varying(64),
    invite_expires_at timestamp with time zone,
    failed_logins integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    invited_by character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_users_status_check CHECK (((status)::text = ANY ((ARRAY['invited'::character varying, 'active'::character varying, 'disabled'::character varying])::text[])))
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    subdomain character varying(100) NOT NULL,
    short_code character varying(20) NOT NULL,
    logo_url text,
    primary_colour character varying(7) DEFAULT '#1A3A5C'::character varying,
    accent_colour character varying(7) DEFAULT '#B8860B'::character varying,
    institution_type character varying(50) DEFAULT 'academic'::character varying,
    address text,
    website character varying(200),
    paystack_split_code character varying(100),
    contact_email character varying(200),
    contact_phone character varying(50),
    active boolean DEFAULT true,
    plan character varying(20) DEFAULT 'standard'::character varying,
    max_documents integer DEFAULT 50000,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    logo_data bytea,
    logo_mime character varying(20),
    logo_updated_at timestamp with time zone,
    approval_required boolean DEFAULT false NOT NULL,
    sig_strict boolean DEFAULT false NOT NULL,
    student_claim_required boolean DEFAULT true NOT NULL,
    disclosure jsonb DEFAULT '{}'::jsonb NOT NULL,
    require_registered boolean DEFAULT false NOT NULL
);


--
-- Name: token_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_purchases (
    id integer NOT NULL,
    matric_number character varying(50) NOT NULL,
    institution character varying(100) NOT NULL,
    bundle_size integer NOT NULL,
    amount_kobo integer NOT NULL,
    paystack_ref character varying(100) NOT NULL,
    paystack_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    email character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: token_purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.token_purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: token_purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.token_purchases_id_seq OWNED BY public.token_purchases.id;


--
-- Name: verification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_log (
    id integer NOT NULL,
    doc_id character varying(64) NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address inet,
    user_agent text,
    result character varying(20) NOT NULL,
    geo_location character varying(100),
    tenant_id uuid,
    payment_method character varying(30) DEFAULT 'none'::character varying NOT NULL,
    CONSTRAINT verification_log_result_check CHECK (((result)::text = ANY ((ARRAY['found'::character varying, 'not_found'::character varying, 'revoked'::character varying, 'superseded'::character varying, 'tampered'::character varying, 'old_link'::character varying])::text[])))
);


--
-- Name: verification_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.verification_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: verification_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.verification_log_id_seq OWNED BY public.verification_log.id;


--
-- Name: verification_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_payments (
    id integer NOT NULL,
    doc_id character varying(64) NOT NULL,
    payer_email character varying(255),
    amount_kobo integer NOT NULL,
    paystack_ref character varying(100) NOT NULL,
    paystack_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    result_shown boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: verification_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.verification_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: verification_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.verification_payments_id_seq OWNED BY public.verification_payments.id;


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: batch_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_rows ALTER COLUMN id SET DEFAULT nextval('public.batch_rows_id_seq'::regclass);


--
-- Name: demo_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_tokens ALTER COLUMN id SET DEFAULT nextval('public.demo_tokens_id_seq'::regclass);


--
-- Name: demo_visitors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_visitors ALTER COLUMN id SET DEFAULT nextval('public.demo_visitors_id_seq'::regclass);


--
-- Name: scan_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_alerts ALTER COLUMN id SET DEFAULT nextval('public.scan_alerts_id_seq'::regclass);


--
-- Name: student_claim_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_claim_codes ALTER COLUMN id SET DEFAULT nextval('public.student_claim_codes_id_seq'::regclass);


--
-- Name: student_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_records ALTER COLUMN id SET DEFAULT nextval('public.student_records_id_seq'::regclass);


--
-- Name: student_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tokens ALTER COLUMN id SET DEFAULT nextval('public.student_tokens_id_seq'::regclass);


--
-- Name: token_purchases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_purchases ALTER COLUMN id SET DEFAULT nextval('public.token_purchases_id_seq'::regclass);


--
-- Name: verification_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_log ALTER COLUMN id SET DEFAULT nextval('public.verification_log_id_seq'::regclass);


--
-- Name: verification_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_payments ALTER COLUMN id SET DEFAULT nextval('public.verification_payments_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: batch_rows batch_rows_batch_id_row_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_rows
    ADD CONSTRAINT batch_rows_batch_id_row_no_key UNIQUE (batch_id, row_no);


--
-- Name: batch_rows batch_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_rows
    ADD CONSTRAINT batch_rows_pkey PRIMARY KEY (id);


--
-- Name: batches batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (id);


--
-- Name: demo_tokens demo_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_tokens
    ADD CONSTRAINT demo_tokens_pkey PRIMARY KEY (id);


--
-- Name: demo_tokens demo_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_tokens
    ADD CONSTRAINT demo_tokens_token_key UNIQUE (token);


--
-- Name: demo_visitors demo_visitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_visitors
    ADD CONSTRAINT demo_visitors_pkey PRIMARY KEY (id);


--
-- Name: documents documents_doc_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_doc_id_key UNIQUE (doc_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: print_specs print_specs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_specs
    ADD CONSTRAINT print_specs_pkey PRIMARY KEY (tenant_id, doc_type);


--
-- Name: scan_alerts scan_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_alerts
    ADD CONSTRAINT scan_alerts_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: signatories signatories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatories
    ADD CONSTRAINT signatories_pkey PRIMARY KEY (id);


--
-- Name: student_claim_codes student_claim_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_claim_codes
    ADD CONSTRAINT student_claim_codes_pkey PRIMARY KEY (id);


--
-- Name: student_lists student_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lists
    ADD CONSTRAINT student_lists_pkey PRIMARY KEY (id);


--
-- Name: student_records student_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_records
    ADD CONSTRAINT student_records_pkey PRIMARY KEY (id);


--
-- Name: student_tokens student_tokens_matric_number_institution_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tokens
    ADD CONSTRAINT student_tokens_matric_number_institution_key UNIQUE (matric_number, institution);


--
-- Name: student_tokens student_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tokens
    ADD CONSTRAINT student_tokens_pkey PRIMARY KEY (id);


--
-- Name: tenant_sign_keys tenant_sign_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sign_keys
    ADD CONSTRAINT tenant_sign_keys_pkey PRIMARY KEY (tenant_id, kid);


--
-- Name: tenant_sis tenant_sis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sis
    ADD CONSTRAINT tenant_sis_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_users tenant_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_short_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_short_code_key UNIQUE (short_code);


--
-- Name: tenants tenants_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_subdomain_key UNIQUE (subdomain);


--
-- Name: token_purchases token_purchases_paystack_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_purchases
    ADD CONSTRAINT token_purchases_paystack_ref_key UNIQUE (paystack_ref);


--
-- Name: token_purchases token_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_purchases
    ADD CONSTRAINT token_purchases_pkey PRIMARY KEY (id);


--
-- Name: verification_log verification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_log
    ADD CONSTRAINT verification_log_pkey PRIMARY KEY (id);


--
-- Name: verification_payments verification_payments_paystack_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_payments
    ADD CONSTRAINT verification_payments_paystack_ref_key UNIQUE (paystack_ref);


--
-- Name: verification_payments verification_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_payments
    ADD CONSTRAINT verification_payments_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: idx_activity_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_target ON public.activity_log USING btree (tenant_id, target_id);


--
-- Name: idx_activity_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_tenant_time ON public.activity_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_batches_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batches_tenant ON public.batches USING btree (tenant_id, created_at DESC);


--
-- Name: idx_claim_codes_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claim_codes_lookup ON public.student_claim_codes USING btree (tenant_id, upper((matric_number)::text)) WHERE ((used_at IS NULL) AND (voided_at IS NULL));


--
-- Name: idx_documents_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_batch ON public.documents USING btree (batch_id) WHERE (batch_id IS NOT NULL);


--
-- Name: idx_documents_doc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_doc_id ON public.documents USING btree (doc_id);


--
-- Name: idx_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_status ON public.documents USING btree (status);


--
-- Name: idx_documents_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_tenant_id ON public.documents USING btree (tenant_id);


--
-- Name: idx_scan_alerts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scan_alerts_tenant ON public.scan_alerts USING btree (tenant_id, created_at DESC);


--
-- Name: idx_signatories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signatories_tenant ON public.signatories USING btree (tenant_id, slot, effective_from DESC);


--
-- Name: idx_student_tokens_matric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_tokens_matric ON public.student_tokens USING btree (matric_number);


--
-- Name: idx_student_tokens_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_tokens_tenant_id ON public.student_tokens USING btree (tenant_id);


--
-- Name: idx_tenant_users_invite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_users_invite ON public.tenant_users USING btree (invite_token_hash);


--
-- Name: idx_tenants_short_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_short_code ON public.tenants USING btree (short_code);


--
-- Name: idx_tenants_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_subdomain ON public.tenants USING btree (subdomain);


--
-- Name: idx_tp_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tp_ref ON public.token_purchases USING btree (paystack_ref);


--
-- Name: idx_verification_log_doc_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_log_doc_time ON public.verification_log USING btree (doc_id, verified_at DESC);


--
-- Name: idx_verification_log_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_log_tenant_id ON public.verification_log USING btree (tenant_id);


--
-- Name: idx_vlog_doc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vlog_doc_id ON public.verification_log USING btree (doc_id);


--
-- Name: idx_vp_doc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vp_doc_id ON public.verification_payments USING btree (doc_id);


--
-- Name: idx_vp_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vp_ref ON public.verification_payments USING btree (paystack_ref);


--
-- Name: uq_scan_alerts_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_scan_alerts_open ON public.scan_alerts USING btree (tenant_id, doc_id, kind) WHERE (acknowledged_at IS NULL);


--
-- Name: uq_student_records_matric; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_student_records_matric ON public.student_records USING btree (tenant_id, upper((matric_number)::text));


--
-- Name: uq_tenant_sign_keys_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tenant_sign_keys_active ON public.tenant_sign_keys USING btree (tenant_id) WHERE ((status)::text = 'active'::text);


--
-- Name: uq_tenant_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tenant_users_email ON public.tenant_users USING btree (tenant_id, lower((email)::text));


--
-- Name: activity_log activity_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: activity_log activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: batch_rows batch_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_rows
    ADD CONSTRAINT batch_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE CASCADE;


--
-- Name: batch_rows batch_rows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_rows
    ADD CONSTRAINT batch_rows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: batches batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: batches batches_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: batches batches_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: batches batches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: documents documents_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: print_specs print_specs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_specs
    ADD CONSTRAINT print_specs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: print_specs print_specs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_specs
    ADD CONSTRAINT print_specs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: scan_alerts scan_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_alerts
    ADD CONSTRAINT scan_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: scan_alerts scan_alerts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_alerts
    ADD CONSTRAINT scan_alerts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: signatories signatories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatories
    ADD CONSTRAINT signatories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: student_claim_codes student_claim_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_claim_codes
    ADD CONSTRAINT student_claim_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: student_claim_codes student_claim_codes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_claim_codes
    ADD CONSTRAINT student_claim_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: student_lists student_lists_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lists
    ADD CONSTRAINT student_lists_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: student_lists student_lists_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lists
    ADD CONSTRAINT student_lists_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: student_records student_records_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_records
    ADD CONSTRAINT student_records_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.student_lists(id) ON DELETE CASCADE;


--
-- Name: student_records student_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_records
    ADD CONSTRAINT student_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: student_tokens student_tokens_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tokens
    ADD CONSTRAINT student_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_sign_keys tenant_sign_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sign_keys
    ADD CONSTRAINT tenant_sign_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_sis tenant_sis_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sis
    ADD CONSTRAINT tenant_sis_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_sis tenant_sis_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_sis
    ADD CONSTRAINT tenant_sis_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: tenant_users tenant_users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: verification_log verification_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_log
    ADD CONSTRAINT verification_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


