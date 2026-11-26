// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CertificateRegistry
/// @notice Публичен регистър с доказателствени записи за издадени цифрови сертификати.
/// @dev В договора се пазят само идентификатор, SHA-256 хеш на PDF файла, адрес на
///      издателя, времеви маркери и статус. Лични данни и самият документ остават
///      извън блокчейна.
contract CertificateRegistry is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    enum Status {
        None,
        Valid,
        Revoked
    }

    enum VerificationResult {
        NotFound,
        Valid,
        HashMismatch,
        Revoked
    }

    struct Certificate {
        bytes32 documentHash;
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt;
        Status status;
    }

    mapping(bytes32 => Certificate) private _certificates;
    mapping(bytes32 => bytes32) private _idByHash;
    mapping(address => string) public issuerNames;

    uint256 public totalIssued;
    uint256 public totalRevoked;

    event IssuerAdded(address indexed issuer, string name);
    event IssuerRemoved(address indexed issuer);
    event CertificateIssued(bytes32 indexed certificateId, bytes32 indexed documentHash, address indexed issuer, uint64 issuedAt);
    event CertificateRevoked(bytes32 indexed certificateId, address indexed revokedBy, string reason, uint64 revokedAt);

    error InvalidHash();
    error InvalidCertificateId();
    error InvalidIssuer();
    error CertificateAlreadyExists(bytes32 certificateId);
    error HashAlreadyRegistered(bytes32 documentHash);
    error CertificateNotFound(bytes32 certificateId);
    error CertificateAlreadyRevoked(bytes32 certificateId);
    error NotAllowedToRevoke(address caller);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidIssuer();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Управление на издателите
    // ------------------------------------------------------------------

    function addIssuer(address issuer, string calldata name) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (issuer == address(0)) revert InvalidIssuer();
        _grantRole(ISSUER_ROLE, issuer);
        issuerNames[issuer] = name;
        emit IssuerAdded(issuer, name);
    }

    /// @dev Премахнатият издател не може да издава нови сертификати, но вече
    ///      издадените от него остават валидни, докато не бъдат отнети.
    function removeIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ISSUER_ROLE, issuer);
        emit IssuerRemoved(issuer);
    }

    function isIssuer(address account) external view returns (bool) {
        return hasRole(ISSUER_ROLE, account);
    }

    // ------------------------------------------------------------------
    // Сертификати
    // ------------------------------------------------------------------

    function issueCertificate(bytes32 certificateId, bytes32 documentHash) external onlyRole(ISSUER_ROLE) {
        if (certificateId == bytes32(0)) revert InvalidCertificateId();
        if (documentHash == bytes32(0)) revert InvalidHash();
        if (_certificates[certificateId].status != Status.None) revert CertificateAlreadyExists(certificateId);
        if (_idByHash[documentHash] != bytes32(0)) revert HashAlreadyRegistered(documentHash);

        uint64 nowTs = uint64(block.timestamp);
        _certificates[certificateId] = Certificate({
            documentHash: documentHash,
            issuer: msg.sender,
            issuedAt: nowTs,
            revokedAt: 0,
            status: Status.Valid
        });
        _idByHash[documentHash] = certificateId;
        unchecked {
            totalIssued++;
        }
        emit CertificateIssued(certificateId, documentHash, msg.sender, nowTs);
    }

    /// @notice Отнема сертификат. Разрешено е на издателя, който го е регистрирал, или на администратора.
    /// @dev Записът не се изтрива. Историята остава в блокчейна чрез събитията.
    function revokeCertificate(bytes32 certificateId, string calldata reason) external {
        Certificate storage cert = _certificates[certificateId];
        if (cert.status == Status.None) revert CertificateNotFound(certificateId);
        if (cert.status == Status.Revoked) revert CertificateAlreadyRevoked(certificateId);
        bool isOriginalIssuer = cert.issuer == msg.sender && hasRole(ISSUER_ROLE, msg.sender);
        if (!isOriginalIssuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotAllowedToRevoke(msg.sender);

        uint64 nowTs = uint64(block.timestamp);
        cert.status = Status.Revoked;
        cert.revokedAt = nowTs;
        unchecked {
            totalRevoked++;
        }
        emit CertificateRevoked(certificateId, msg.sender, reason, nowTs);
    }

    /// @notice Сравнява подаден хеш със записания за сертификата.
    function verifyCertificate(bytes32 certificateId, bytes32 documentHash) external view returns (VerificationResult) {
        Certificate storage cert = _certificates[certificateId];
        if (cert.status == Status.None) return VerificationResult.NotFound;
        if (cert.documentHash != documentHash) return VerificationResult.HashMismatch;
        if (cert.status == Status.Revoked) return VerificationResult.Revoked;
        return VerificationResult.Valid;
    }

    function getCertificate(bytes32 certificateId)
        external
        view
        returns (bytes32 documentHash, address issuer, uint64 issuedAt, uint64 revokedAt, Status status)
    {
        Certificate storage cert = _certificates[certificateId];
        return (cert.documentHash, cert.issuer, cert.issuedAt, cert.revokedAt, cert.status);
    }

    function findByHash(bytes32 documentHash) external view returns (bytes32) {
        return _idByHash[documentHash];
    }
}
