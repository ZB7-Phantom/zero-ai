'use client';
import { useState } from 'react';

export default function Home() {
  const [formData, setFormData] = useState({
    clinicName: '',
    contactName: '',
    whatsapp: '',
    email: '',
    clinicType: 'General'
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/leads/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setStatus('success');
    } catch (err) {
      setStatus('error');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <main className="min-h-screen bg-background text-foreground font-sans selection:bg-accent/20">
      {/* 1. Hero */}
      <section className="px-6 py-24 md:py-32 max-w-5xl mx-auto flex flex-col items-center text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-foreground">
          Your clinic already answers 200 messages a day. It just doesn't know it yet.
        </h1>
        <p className="text-lg md:text-xl text-foreground/80 mb-10 max-w-3xl leading-relaxed">
          Zero connects to your clinic's WhatsApp and runs intake, booking, and the queue — instantly, for every patient, without anyone touching a phone.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <a href="#demo" className="bg-accent hover:bg-accent-hover text-white px-8 py-4 rounded-full font-semibold transition-colors duration-200">
            Book a Demo
          </a>
          <a href="#how-it-works" className="text-foreground/70 hover:text-foreground px-8 py-4 font-medium transition-colors">
            See how it works ↓
          </a>
        </div>
      </section>

      {/* 2. The Problem */}
      <section className="px-6 py-20 bg-foreground/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-6">The front desk is where good clinics quietly lose money.</h2>
          <p className="text-lg text-foreground/80 leading-relaxed">
            Missed calls. Paper intake. A queue that lives on a whiteboard. Patients who show up to find their history isn't there — or don't show up at all. Front desk staff cost $35,000–$55,000 a year, and when they quit, the clinic remembers nothing.
          </p>
        </div>
      </section>

      {/* 3. How Zero Works */}
      <section id="how-it-works" className="px-6 py-24 max-w-5xl mx-auto">
        <div className="space-y-16">
          <div className="flex gap-6 items-start">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xl">1</div>
            <div>
              <h3 className="text-xl font-bold mb-2">Patients message your clinic on WhatsApp — exactly like they already do.</h3>
              <p className="text-foreground/70 text-lg">Nothing changes for them.</p>
            </div>
          </div>
          <div className="flex gap-6 items-start">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xl">2</div>
            <div>
              <h3 className="text-xl font-bold mb-2">Zero handles the conversation.</h3>
              <p className="text-foreground/70 text-lg">Intake, booking, queue number, reminders — instantly, in natural language, 24/7.</p>
            </div>
          </div>
          <div className="flex gap-6 items-start">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xl">3</div>
            <div>
              <h3 className="text-xl font-bold mb-2">Your staff sees everything on one screen.</h3>
              <p className="text-foreground/70 text-lg">Live queue, full inbox, and ZeroChat — where staff step in only when Zero flags something that needs a human.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. ZeroChat / Dashboard */}
      <section className="px-6 py-24 bg-accent text-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Zero knows what it doesn't know.</h2>
          <p className="text-xl text-white/90 max-w-3xl mx-auto mb-12 leading-relaxed">
            Urgent symptoms. Angry patients. Billing disputes. Anything outside the clinic's scope — Zero escalates immediately, with full conversation context, so your staff never make a patient repeat themselves.
          </p>
          <div className="bg-foreground/20 rounded-2xl aspect-video w-full max-w-4xl mx-auto border border-white/10 flex items-center justify-center backdrop-blur-sm">
            <p className="text-white/50 font-medium tracking-widest uppercase">Dashboard Interface Mockup</p>
          </div>
        </div>
      </section>

      {/* 5. RAnA section */}
      <section className="px-6 py-24 max-w-3xl mx-auto text-center border-b border-foreground/10">
        <h2 className="text-2xl font-bold mb-6">Zero is the first agent on RAnA.</h2>
        <p className="text-lg text-foreground/80 leading-relaxed">
          RAnA is a marketplace where businesses rent AI agents that run entire workflows — not chatbots bolted onto old software, but agents that actually do the job. Zero is the first: a full front-desk operator for independent clinics. More agents, for more of the work businesses do every day, are coming.
        </p>
      </section>

      {/* 6. FAQ */}
      <section className="px-6 py-24 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-12 text-center">FAQ</h2>
        <div className="space-y-8">
          <div>
            <h4 className="font-bold text-lg mb-2">Do patients need to download anything?</h4>
            <p className="text-foreground/80">No. They message your existing WhatsApp number exactly as before.</p>
          </div>
          <div>
            <h4 className="font-bold text-lg mb-2">What happens if Zero can't handle something?</h4>
            <p className="text-foreground/80">It escalates to your staff instantly, with full context, through ZeroChat.</p>
          </div>
          <div>
            <h4 className="font-bold text-lg mb-2">How long does setup take?</h4>
            <p className="text-foreground/80">Most clinics are live within a day — we connect your number and configure your services with you.</p>
          </div>
          <div>
            <h4 className="font-bold text-lg mb-2">Is patient data secure?</h4>
            <p className="text-foreground/80">Yes — conversations and records are encrypted and only accessible to your clinic's staff.</p>
          </div>
          <div>
            <h4 className="font-bold text-lg mb-2">What does it cost?</h4>
            <p className="text-foreground/80">Plans start at $199/month — most clinics save many times that in recovered front-desk cost. Full pricing on the demo call.</p>
          </div>
          <div>
            <h4 className="font-bold text-lg mb-2">Do I need new hardware or software?</h4>
            <p className="text-foreground/80">No. Zero runs entirely through WhatsApp and a browser dashboard.</p>
          </div>
        </div>
      </section>

      {/* 7. Book a Demo */}
      <section id="demo" className="px-6 py-24 bg-foreground/5">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-4">See Zero in action</h2>
            <p className="text-foreground/70">Enter your details and we'll reach out to schedule a demo.</p>
          </div>
          
          {status === 'success' ? (
            <div className="bg-accent/10 text-accent p-8 rounded-2xl text-center border border-accent/20">
              <h3 className="font-bold text-xl mb-2">Got it.</h3>
              <p>We'll reach out within a day to get your clinic connected.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 bg-background p-8 rounded-2xl shadow-sm border border-foreground/5">
              <div>
                <label className="block text-sm font-medium mb-2">Clinic Name</label>
                <input required name="clinicName" value={formData.clinicName} onChange={handleChange} className="w-full p-3 rounded-lg border border-foreground/20 bg-background focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Contact Name</label>
                <input required name="contactName" value={formData.contactName} onChange={handleChange} className="w-full p-3 rounded-lg border border-foreground/20 bg-background focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">WhatsApp Number</label>
                <input required type="tel" name="whatsapp" value={formData.whatsapp} onChange={handleChange} className="w-full p-3 rounded-lg border border-foreground/20 bg-background focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full p-3 rounded-lg border border-foreground/20 bg-background focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Clinic Type</label>
                <select required name="clinicType" value={formData.clinicType} onChange={handleChange} className="w-full p-3 rounded-lg border border-foreground/20 bg-background focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent">
                  {['General', 'Dental', 'Physiotherapy', 'Chiropractic', 'Wellness', 'Mental Health', 'Other'].map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              {status === 'error' && (
                <p className="text-red-500 text-sm">Something went wrong. Please try again.</p>
              )}
              <button 
                disabled={status === 'loading'}
                className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {status === 'loading' ? 'Submitting...' : 'Talk to Zero\'s team'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="px-6 py-12 border-t border-foreground/10 flex flex-col md:flex-row justify-between items-center max-w-5xl mx-auto text-foreground/60">
        <p>Zero, by North. A RAnA company.</p>
        <div className="flex gap-6 mt-4 md:mt-0">
          <a href="#demo" className="hover:text-foreground transition-colors">Book a Demo</a>
          <a href="#demo" className="hover:text-foreground transition-colors">Contact</a>
        </div>
      </footer>
    </main>
  );
}
