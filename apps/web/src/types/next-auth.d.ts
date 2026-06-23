import "next-auth";
import "next-auth/jwt";

type Role = "USER" | "ADMIN" | "MANAGER";

// [SPIKE Q1] Claim w3id rilevanti per ruoli/gerarchia, esposti nel menu
// account per ispezione (verifica empirica con manager/HR). Tutti opzionali:
// presenti solo per login via provider `ibmsso`, assenti per Google.
// Da rivedere/rimuovere quando il modello ruoli sarà deciso (vedi TODO Q1).
interface W3idClaims {
  employeeType?: string; // ibmEdEmployeeType (es. "P" = Practitioner)
  hrActive?: string; // ibmEdHrActive (es. "A")
  isManager?: string; // ibmEdIsManager ("Y"/"N")
  managerEmail?: string; // managerEmail — chiave per la gerarchia riporti
  managerFirstName?: string; // managerFirstName — nome del manager
  managerLastName?: string; // managerLastName — cognome del manager
  jobResponsibilities?: string; // ibmEdJobResponsibilities
}

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
      w3id?: W3idClaims;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: string;
    providerSub?: string;
    role?: Role;
    // Email del manager diretto (claim w3id), tenuta nel token per
    // persistenza a DB (provisioning) e forward via proxy BFF.
    managerEmail?: string;
    w3id?: W3idClaims;
  }
}
