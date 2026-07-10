import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { User, Heart, ChevronRight, ChevronLeft, Check } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

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

  const goToPatient = () => {
    setError("");
    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
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
        patient_name:
          patientName.trim() || displayName.trim() || username.trim(),
        patient_date_of_birth: patientDob || null,
        patient_sex: patientSex || null,
      });
      setStep("done");
    } catch (err: any) {
      setError(getErrorMessage(err, "Setup failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    await refreshUser();
    navigate("/");
  };

  const labelClass = "mb-1 block text-sm font-medium";

  return (
    // Safe-area insets live on the outer shell so the inner 1rem padding is
    // preserved on devices without insets (pt-safe would otherwise zero it).
    <div className="flex min-h-dvh flex-col bg-muted/30 pt-safe pb-safe pl-safe pr-safe">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6 sm:p-8 shadow-raised">
          {/* Step indicator */}
          <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
            {["welcome", "account", "patient", "done"].map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`h-2.5 w-2.5 rounded-full transition-colors ${
                    s === step
                      ? "bg-primary"
                      : ["welcome", "account", "patient", "done"].indexOf(
                            step,
                          ) > i
                        ? "bg-primary/50"
                        : "bg-muted-foreground/25"
                  }`}
                />
                {i < 3 && <div className="h-px w-6 bg-muted-foreground/25" />}
              </div>
            ))}
          </div>

          {/* Welcome */}
          {step === "welcome" && (
            <div className="text-center space-y-4">
              <img
                src="/logo.svg"
                alt="Asclepius"
                className="h-14 w-14 mx-auto rounded-lg"
              />
              <h1 className="text-2xl font-semibold">Welcome to Asclepius</h1>
              <p className="text-muted-foreground text-sm">
                Your self-hosted medical records manager. Let's set up your
                account and create your first patient profile in a few quick
                steps.
              </p>
              <Button
                size="lg"
                className="mt-4 w-full sm:w-auto"
                onClick={() => setStep("account")}
              >
                Get Started <ChevronRight className="h-4 w-4" />
              </Button>
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
                This will be the administrator account for your Asclepius
                instance.
              </p>

              {error && (
                <div className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div>
                <label className={labelClass}>Display Name</label>
                <Input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. John Smith"
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Your full name (used to pre-fill patient profile)
                </p>
              </div>

              <div>
                <label className={labelClass}>Username *</label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. jsmith"
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Password *</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>Confirm Password *</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => setStep("welcome")}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={goToPatient}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
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
                Pre-filled with your account info. Edit as needed — you can add
                more patients later.
              </p>

              {error && (
                <div className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div>
                <label className={labelClass}>Patient Name *</label>
                <Input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Date of Birth</label>
                  <Input
                    type="date"
                    value={patientDob}
                    onChange={(e) => setPatientDob(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Sex</label>
                  <Select
                    value={patientSex}
                    onChange={(e) => setPatientSex(e.target.value)}
                  >
                    <option value="">—</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => setStep("account")}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={handleComplete}
                  loading={loading}
                >
                  {loading ? "Setting up..." : "Complete Setup"}
                  {!loading && <Check className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
                <Check className="h-8 w-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold">You're All Set!</h2>
              <p className="text-sm text-muted-foreground">
                Your account and patient profile have been created. You can now
                start uploading medical documents, configuring your LLM and OCR
                settings, and managing your records.
              </p>
              <Button
                size="lg"
                className="mt-2 w-full sm:w-auto"
                onClick={handleFinish}
              >
                Go to Dashboard <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
