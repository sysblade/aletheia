/**
 * WebSocket message received from CertStream API.
 * Can be either a certificate update or a heartbeat message.
 */
export interface CertStreamMessage {
  message_type: "certificate_update" | "heartbeat";
  data: CertStreamData;
}

/**
 * Certificate update data from CertStream containing the leaf certificate,
 * certificate chain, and metadata about the CT log entry.
 */
export interface CertStreamData {
  update_type: string;
  leaf_cert: CertStreamLeafCert;
  chain: CertStreamChainCert[];
  cert_index: number;
  cert_link: string;
  seen: number;
  source: CertStreamSource;
}

/**
 * End-entity (leaf) certificate from CertStream with full certificate details
 * including subject, issuer, validity period, and X.509 extensions.
 */
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

/**
 * Intermediate or root certificate in the certificate chain.
 * Contains subset of fields compared to leaf certificate.
 */
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

/**
 * Certificate Transparency log that issued this certificate entry.
 */
export interface CertStreamSource {
  url: string;
  name: string;
}
