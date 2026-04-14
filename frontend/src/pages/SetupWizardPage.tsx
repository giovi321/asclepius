import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/api/client";
import { Activity, User, Heart, ChevronRight, ChevronLeft, Check } from "lucide-react";

type Step = "welcome" | "account" | "patient" | "done";

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Account fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Patient fields (pre-filled from account display_name)
  const [patientName, setPatientName] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [patientSex, setPatientSex] = useState("");
  const [patientBloodType, setPatientBloodType] = useState("");
  const [patientAllergies, setPatientAllergies] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientInsuranceCompany, setPatientInsuranceCompany] = useState("");
  const [patientInsuranceNumber, setPatientInsuranceNumber] = useState("");

  const goToPatient = () => {
    setError("");
    if (!username.trim()) { setError("Username is required"); return; }
    if (!password) { setError("Password is required"); return; }
    if (password.length < 4) { setError("Password must be at least 4 characters"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    // Pre-fill patient name from display name if empty
    if (!patientName) setPatientName(displayName || username);
    setStep("patient");
  };

  const handleComplete = async () => {
    setError("");
    setLoading(true);
    try {
      await api.post("/setup/complete", {
        username: username.trim(),
        password,
        display_name: displayName.trim() || username.trim(),
        patient_name: patientName.trim() || displayName.trim() || username.trim(),
        patient_date_of_birth: patientDob || null,
        patient_sex: patientSex || null,
        patient_blood_type: patientBloodType || null,
        patient_allergies: patientAllergies || null,
        patient_phone: patientPhone || null,
        patient_email: patientEmail || null,
        patient_address: patientAddress || null,
        patient_insurance_company: patientInsuranceCompany || null,
        patient_insurance_number: patientInsuranceNumber || null,
      });
      setStep("done");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    await refreshUser();
    navigate("/");
  };

  const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";
  const labelClass = "mb-1 block text-sm font-medium";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-8 shadow-sm">

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {["welcome", "account", "patient", "done"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full transition-colors ${
                s === step ? "bg-primary" :
                ["welcome", "account", "patient", "done"].indexOf(step) > i ? "bg-primary/50" : "bg-muted-foreground/25"
              }`} />
              {i < 3 && <div className="h-px w-6 bg-muted-foreground/25" />}
            </div>
          ))}
        </div>

        {/* Welcome */}
        {step === "welcome" && (
          <div className="text-center space-y-4">
            <Activity className="h-12 w-12 mx-auto text-primary" />
            <h1 className="text-2xl font-semibold">Welcome to Asclepius</h1>
            <p className="text-muted-foreground text-sm">
              Your self-hosted medical records manager. Let's set up your account
              and create your first patient profile in a few quick steps.
            </p>
            <button
              onClick={() => setStep("account")}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get Started <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Account creation */}
        {step === "account" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Create Your Account</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will be the administrator account for your Asclepius instance.
            </p>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            <div>
              <label className={labelClass}>Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass} placeholder="e.g. John Smith" autoFocus />
              <p className="mt-1 text-xs text-muted-foreground">Your full name (used to pre-fill patient profile)</p>
            </div>

            <div>
              <label className={labelClass}>Username *</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className={inputClass} placeholder="e.g. jsmith" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Password *</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Confirm Password *</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass} required />
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep("welcome")}
                className="inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm hover:bg-accent">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={goToPatient}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Patient creation */}
        {step === "patient" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">First Patient Profile</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Pre-filled with your account info. Edit as needed — you can add more patients later.
            </p>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            <div>
              <label className={labelClass}>Patient Name *</label>
              <input type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)}
                className={inputClass} required autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Date of Birth</label>
                <input type="date" value={patientDob} onChange={(e) => setPatientDob(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Sex</label>
                <select value={patientSex} onChange={(e) => setPatientSex(e.target.value)} className={inputClass}>
                  <option value="">—</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Blood Type</label>
                <select value={patientBloodType} onChange={(e) => setPatientBloodType(e.target.value)} className={inputClass}>
                  <option value="">—</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bt) => (
                    <option key={bt} value={bt}>{bt}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input type="tel" value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)}
                  className={inputClass} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={patientEmail} onChange={(e) => setPatientEmail(e.target.value)}
                className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Address</label>
              <input type="text" value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)}
                className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Allergies</label>
              <input type="text" value={patientAllergies} onChange={(e) => setPatientAllergies(e.target.value)}
                className={inputClass} placeholder="e.g. Penicillin, Latex" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Insurance Company</label>
                <input type="text" value={patientInsuranceCompany} onChange={(e) => setPatientInsuranceCompany(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Insurance Number</label>
                <input type="text" value={patientInsuranceNumber} onChange={(e) => setPatientInsuranceNumber(e.target.value)}
                  className={inputClass} />
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep("account")}
                className="inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm hover:bg-accent">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={handleComplete} disabled={loading}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {loading ? "Setting up..." : "Complete Setup"}
                {!loading && <Check className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-semibold">You're All Set!</h2>
            <p className="text-sm text-muted-foreground">
              Your account and patient profile have been created. You can now start
              uploading medical documents, configuring your LLM and OCR settings, and
              managing your records.
            </p>
            <button
              onClick={handleFinish}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Go to Dashboard <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
