export interface CertStreamMessage {
  message_type: "certificate_update" | "heartbeat";
  data: CertStreamData;
}

export interface CertStreamData {
  update_type: string;
  leaf_cert: CertStreamLeafCert;
  chain: CertStreamChainCert[];
  cert_index: number;
  cert_link: string;
  seen: number;
  source: CertStreamSource;
}

export interface CertStreamLeafCert {
  subject: {
    CN?: string;
    O?: string;
    L?: string;
    ST?: string;
    C?: string;
    aggregated: string;
  };
  extensions: {
    subjectAltName?: string;
    keyUsage?: string;
    extendedKeyUsage?: string;
    basicConstraints?: string;
    subjectKeyIdentifier?: string;
    authorityKeyIdentifier?: string;
    authorityInfoAccess?: string;
    certificatePolicies?: string;
    crlDistributionPoints?: string;
    signedCertificateTimestampList?: string;
  };
  not_before: number;
  not_after: number;
  serial_number: string;
  fingerprint: string;
  as_der: string;
  all_domains: string[];
  issuer: {
    CN?: string;
    O?: string;
    L?: string;
    ST?: string;
    C?: string;
    aggregated: string;
  };
}

export interface CertStreamChainCert {
  subject: {
    CN?: string;
    O?: string;
    aggregated: string;
  };
  not_before: number;
  not_after: number;
  serial_number: string;
  fingerprint: string;
  as_der: string;
}

export interface CertStreamSource {
  url: string;
  name: string;
}
